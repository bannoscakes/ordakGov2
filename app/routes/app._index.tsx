import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  ProgressBar,
  Collapsible,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: {
        id: true,
        diagnosticsExpressButtonsVisible: true,
        diagnosticsCartDrawerSeenAt: true,
        diagnosticsCartPageSeenAt: true,
        locations: {
          select: { id: true, name: true, isActive: true, supportsPickup: true },
        },
        zones: {
          select: { id: true, basePrice: true, isActive: true, locationId: true },
        },
      },
    });

    if (!shop) {
      // afterAuth bootstraps the Shop row on install. If we land here
      // without one, something cleared it (manual DB action, partial
      // uninstall) — tell the merchant to reinstall instead of rendering
      // a fake "0/4 complete" checklist that hides the broken state.
      throw new Response("Shop not found — reinstall the app", { status: 404 });
    }

    const [orderCount, slotCount, templateCount] = await Promise.all([
      prisma.orderLink.count({
        where: { slot: { location: { shopId: shop.id } } },
      }),
      prisma.slot.count({
        where: { location: { shopId: shop.id }, isActive: true },
      }),
      prisma.slotTemplate.count({
        where: { location: { shopId: shop.id }, isActive: true },
      }),
    ]);

    const activeLocations = shop.locations.filter((l) => l.isActive);
    const activeZones = shop.zones.filter((z) => z.isActive);

    // Locations that say they do pickup but have zero pickup templates — the
    // cart-block has nothing to surface for them and would render the
    // misleading "Pickup not available on this date" message for any date.
    const pickupCapableLocations = activeLocations.filter((l) => l.supportsPickup);
    let pickupHoursMissingLocation: { id: string; name: string } | null = null;
    if (pickupCapableLocations.length > 0) {
      const counts = await Promise.all(
        pickupCapableLocations.map((l) =>
          prisma.slotTemplate.count({
            where: {
              locationId: l.id,
              fulfillmentType: "pickup",
              isActive: true,
            },
          }).then((count) => ({ id: l.id, name: l.name, count })),
        ),
      );
      const missing = counts.find((c) => c.count === 0);
      if (missing) pickupHoursMissingLocation = { id: missing.id, name: missing.name };
    }

    let zoneWithPriceCount = 0;
    for (const z of activeZones) {
      if (z.basePrice == null) {
        logger.warn("Dashboard: zone with null basePrice", { zoneId: z.id });
        continue;
      }
      const price = Number(z.basePrice.toString());
      if (!Number.isFinite(price)) {
        logger.warn("Dashboard: zone with non-finite basePrice", {
          zoneId: z.id,
          raw: z.basePrice.toString(),
        });
        continue;
      }
      if (price < 0) {
        logger.warn("Dashboard: zone with negative basePrice", {
          zoneId: z.id,
          price,
        });
        continue;
      }
      if (price > 0) zoneWithPriceCount++;
    }

    const firstZoneId = activeZones[0]?.id ?? null;
    // Open the theme editor pre-scoped to the cart template. We deliberately
    // do NOT use ?addAppBlockId=<uid>/cart-scheduler — that param errors with
    // "There is a problem with the app block" on some themes (notably
    // Horizon's section-groups format, where app sections aren't directly
    // resolvable by uid+handle through the deep-link). Sticking to
    // ?template=cart works on every theme; the merchant follows the
    // step-by-step description text to add the section once landed.
    const shopHandle = session.shop.replace(".myshopify.com", "");
    const themeEditorUrl =
      `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=cart`;
    // App Embeds tab deep link with the cart-scheduler-embed pre-selected.
    // The activateAppId param takes the form `{extension_uuid}/{handle}` —
    // the extension uuid lives in extensions/cart-block/shopify.extension.toml
    // and is stable across stores (it identifies the bundle, not the install).
    const cartSchedulerEmbedUrl =
      `https://admin.shopify.com/store/${shopHandle}/themes/current/editor` +
      `?context=apps&activateAppId=c9e975ac-5a87-7a0c-c4f8-a5b69a342ca6a3e4e584/cart-scheduler-embed`;

    // Cart-block surface auto-detection. The cart-block POSTs to
    // /apps/ordak-go/diagnostics every time it mounts on the storefront,
    // stamping `diagnosticsCart{Drawer,Page}SeenAt`. Considered "active" if
    // we've seen a report within the last 7 days. Stale older than that
    // means the merchant probably uninstalled the embed/block, or the
    // storefront stopped rendering — flag it on the dashboard so the
    // merchant notices.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const cartDrawerSeenAt = shop.diagnosticsCartDrawerSeenAt;
    const cartPageSeenAt = shop.diagnosticsCartPageSeenAt;
    const cartDrawerActive =
      cartDrawerSeenAt != null && nowMs - cartDrawerSeenAt.getTime() < SEVEN_DAYS_MS;
    const cartPageActive =
      cartPageSeenAt != null && nowMs - cartPageSeenAt.getTime() < SEVEN_DAYS_MS;
    const cartDrawerStale =
      cartDrawerSeenAt != null && !cartDrawerActive;
    const cartPageStale =
      cartPageSeenAt != null && !cartPageActive;

    return json({
      shop: session.shop,
      themeEditorUrl,
      cartSchedulerEmbedUrl,
      diagnosticsExpressButtonsVisible: shop.diagnosticsExpressButtonsVisible,
      cartBlockSurface: {
        drawerActive: cartDrawerActive,
        pageActive: cartPageActive,
        drawerStale: cartDrawerStale,
        pageStale: cartPageStale,
        // Last-seen timestamps for the dashboard's stale-warning copy.
        // Sent as ISO strings because Remix's json() serializes Date to
        // string anyway; making the contract explicit avoids client-side
        // surprises.
        drawerSeenAt: cartDrawerSeenAt?.toISOString() ?? null,
        pageSeenAt: cartPageSeenAt?.toISOString() ?? null,
      },
      stats: {
        locations: activeLocations.length,
        zones: activeZones.length,
        slots: slotCount,
        orders: orderCount,
      },
      checklist: {
        locationCreated: activeLocations.length > 0,
        zoneCreated: activeZones.length > 0,
        zonePriceSet: zoneWithPriceCount > 0,
        timeSlotsConfigured: templateCount > 0,
        firstZoneId,
        pickupHoursRequired: pickupCapableLocations.length > 0,
        pickupHoursMissingLocation,
      },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.error("Dashboard loader failed", error, { shop: session.shop });
    throw error;
  }
}

type ChecklistItem = {
  id: string;
  label: string;
  description: string;
  done: boolean;
  manual?: boolean;
  cta: { label: string; to: string; external?: boolean };
};

export default function Index() {
  const {
    shop,
    themeEditorUrl,
    cartSchedulerEmbedUrl,
    diagnosticsExpressButtonsVisible,
    cartBlockSurface,
    stats,
    checklist,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Cart-block setup state — derived from passive surface telemetry.
  // The merchant can use either or both surfaces; we observe and adapt.
  const cartBlockActive = cartBlockSurface.drawerActive || cartBlockSurface.pageActive;
  const cartBlockBoth = cartBlockSurface.drawerActive && cartBlockSurface.pageActive;
  const cartBlockStaleAny = cartBlockSurface.drawerStale || cartBlockSurface.pageStale;
  // Partial-stale: one surface active, the other previously seen but now
  // stale. Most likely cause is the merchant disabling one of the two
  // blocks. We append a note so the merchant who configured BOTH but lost
  // one notices, instead of seeing only the still-active surface confirmed.
  const partialStaleNote = (() => {
    if (cartBlockSurface.drawerActive && cartBlockSurface.pageStale) {
      return " The cart page surface (App Block) went silent — re-enable it in the cart template if you still want it.";
    }
    if (cartBlockSurface.pageActive && cartBlockSurface.drawerStale) {
      return " The cart drawer surface (App Embed) went silent — re-enable it in App embeds if you still want it.";
    }
    return "";
  })();
  const cartBlockDescription = (() => {
    if (cartBlockBoth) {
      return "Both surfaces active. Customers see the scheduler in both the cart drawer and on the /cart page.";
    }
    if (cartBlockSurface.drawerActive) {
      return (
        "Cart drawer active. Customers see the scheduler when they open the cart drawer. To also enable the /cart page, edit the cart template and add the Ordak Cart Scheduler block." +
        partialStaleNote
      );
    }
    if (cartBlockSurface.pageActive) {
      return (
        "Cart page active. Customers see the scheduler on the /cart page. To also enable the cart drawer, open theme editor → App embeds → Cart Scheduler Drawer." +
        partialStaleNote
      );
    }
    if (cartBlockStaleAny) {
      return "The cart-block hasn't been seen on your storefront recently. It may have been removed from the theme. Re-enable it in the theme editor.";
    }
    return "Choose where customers see the scheduling widget. Cart drawer (App Embed, recommended) shows it in the slide-out cart panel. Cart page (App Block) shows it on the /cart page. Pick one or use both.";
  })();
  // CTA selection covers four states explicitly. Without the both-active
  // branch, an already-complete task pointed at App Embeds — confusing for
  // merchants whose drawer + page are both running healthy.
  const cartBlockCta = cartBlockBoth
    ? { label: "Open theme editor", to: themeEditorUrl, external: true }
    : cartBlockSurface.pageActive
      ? { label: "Open cart template", to: themeEditorUrl, external: true }
      : { label: "Open App embeds", to: cartSchedulerEmbedUrl, external: true };

  const items: ChecklistItem[] = [
    {
      id: "location",
      label: "Create a location",
      description: "Address orders ship from or are picked up from.",
      done: checklist.locationCreated,
      cta: checklist.locationCreated
        ? { label: "Manage", to: "/app/locations" }
        : { label: "Add location", to: "/app/setup?step=1" },
    },
    {
      id: "zone",
      label: "Create a delivery zone",
      description: "Postcodes (or radius) you deliver to.",
      done: checklist.zoneCreated,
      cta: checklist.zoneCreated
        ? { label: "Manage zones", to: "/app/zones" }
        : { label: "Add zone", to: "/app/setup?step=2" },
    },
    {
      id: "price",
      label: "Set zone delivery price",
      description: "Base delivery charge customers pay per zone.",
      done: checklist.zonePriceSet,
      cta:
        checklist.zoneCreated && checklist.firstZoneId
          ? {
              label: checklist.zonePriceSet ? "Edit pricing" : "Set price",
              to: `/app/zones/${checklist.firstZoneId}?section=pricing`,
            }
          : { label: "Add zone first", to: "/app/setup?step=2" },
    },
    {
      id: "slots",
      label: "Configure time slots",
      description: "Days, hours, capacity, and per-slot premiums per zone.",
      done: checklist.timeSlotsConfigured,
      cta:
        checklist.zoneCreated && checklist.firstZoneId
          ? {
              label: checklist.timeSlotsConfigured ? "Edit slots" : "Configure slots",
              to: `/app/zones/${checklist.firstZoneId}?section=slots`,
            }
          : { label: "Add zone first", to: "/app/setup?step=2" },
    },
    ...(checklist.pickupHoursRequired
      ? [
          {
            id: "pickup-hours",
            label: "Configure pickup hours",
            description:
              checklist.pickupHoursMissingLocation
                ? `${checklist.pickupHoursMissingLocation.name} supports pickup but has no hours configured. Customers can't book pickup until you set hours.`
                : "Days, hours, and daily capacity for store pickup at each location.",
            done: !checklist.pickupHoursMissingLocation,
            cta: checklist.pickupHoursMissingLocation
              ? {
                  label: "Configure hours",
                  to: `/app/locations/${checklist.pickupHoursMissingLocation.id}?section=pickup-hours`,
                }
              : { label: "Manage locations", to: "/app/locations" },
          } satisfies ChecklistItem,
        ]
      : []),
    {
      id: "hide-express-buttons",
      label: "Hide express checkout buttons",
      description:
        "Shop Pay / Apple Pay / Buy-it-now bypass the cart drawer, skipping the scheduling step. " +
        "Open theme editor → App embeds → Ordak Cart Scheduler → enable \"Hide express checkout buttons\".",
      done: false,
      manual: true,
      cta: { label: "Open app embed", to: cartSchedulerEmbedUrl, external: true },
    },
    {
      id: "delivery-customization",
      label: "Activate delivery customization",
      description: "Hides shipping rates that don't match the cart-stage choice.",
      done: false,
      manual: true,
      cta: { label: "Install", to: "/app/install-delivery-customization" },
    },
    {
      id: "theme",
      label: cartBlockActive
        ? `Cart-block active${cartBlockBoth ? " (both surfaces)" : cartBlockSurface.drawerActive ? " (cart drawer)" : " (cart page)"}`
        : "Add the cart-block to your theme",
      description: cartBlockDescription,
      // Auto-tracked via storefront telemetry (`diagnosticsCart{Drawer,Page}SeenAt`).
      // We mark the task done as soon as we observe the cart-block rendering
      // on either surface — drops the manual flag so it counts toward the
      // setup-guide progress bar.
      done: cartBlockActive,
      manual: !cartBlockActive,
      // External link: the theme editor lives at admin.shopify.com, not
      // inside the embedded Remix iframe. Routing via Remix navigate would
      // 404 inside the iframe.
      cta: cartBlockCta,
    },
  ];

  const autoTracked = items.filter((i) => !i.manual);
  const completedCount = autoTracked.filter((i) => i.done).length;
  const totalCount = autoTracked.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const setupComplete = totalCount > 0 && completedCount === totalCount;
  // Skip manual items — they're permanently `done: false` (no programmatic
  // signal can mark them complete), so without this filter `upNext` would
  // pin to "Hide express checkout buttons" or "Activate delivery
  // customization" forever and shadow the real next auto-tracked step.
  // Caught by the Dev → main cumulative review (2026-05-09, confidence 85).
  const upNext = autoTracked.find((i) => !i.done) ?? null;

  const [showAllTasks, setShowAllTasks] = useState(false);

  function onCta(item: ChecklistItem) {
    if (item.cta.external) {
      window.open(item.cta.to, "_top");
      return;
    }
    navigate(item.cta.to);
  }

  return (
    <Page title="Dashboard">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">Welcome to Ordak Go</Text>
              <Text as="p" tone="subdued">Connected to {shop}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {diagnosticsExpressButtonsVisible && (
          <Layout.Section>
            <Banner
              tone="warning"
              title="Express checkout buttons are visible on your storefront"
              action={{
                content: "Open app embed",
                onAction: () => window.open(cartSchedulerEmbedUrl, "_top"),
              }}
            >
              <Text as="p">
                Shop Pay / Apple Pay / Buy-it-now buttons let customers skip the cart drawer,
                which bypasses the scheduling step. Enable &quot;Hide express checkout buttons&quot;
                in the cart-scheduler app embed to block them.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Setup guide</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {setupComplete
                      ? "Core setup complete. Manual steps below are worth ticking off before going live."
                      : `${completedCount} of ${totalCount} core steps complete`}
                  </Text>
                </BlockStack>
                <Badge tone={setupComplete ? "success" : undefined}>
                  {setupComplete ? "Ready" : `${completedCount}/${totalCount}`}
                </Badge>
              </InlineStack>
              <ProgressBar progress={progressPct} size="small" />

              {upNext ? (
                <Card background="bg-surface-secondary">
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                    gap="400"
                  >
                    {/* min-width: 0 lets the BlockStack shrink below its
                        intrinsic content width, which is what makes the
                        line-clamp on the description actually kick in
                        instead of pushing the Resume button off-screen. */}
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Up next</Text>
                        <Text as="p" fontWeight="semibold">{upNext.label}</Text>
                        <span
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          <Text as="span" tone="subdued" variant="bodySm">
                            {upNext.description}
                          </Text>
                        </span>
                      </BlockStack>
                    </div>
                    <div style={{ flex: "0 0 auto" }}>
                      <Button onClick={() => onCta(upNext)} variant="primary">
                        Resume setup
                      </Button>
                    </div>
                  </InlineStack>
                </Card>
              ) : null}

              <InlineStack align="start">
                <Button
                  variant="plain"
                  onClick={() => setShowAllTasks((v) => !v)}
                  ariaExpanded={showAllTasks}
                  ariaControls="setup-guide-all-tasks"
                >
                  {showAllTasks
                    ? "Hide all tasks"
                    : `Show all ${items.length} tasks`}
                </Button>
              </InlineStack>

              <Collapsible
                id="setup-guide-all-tasks"
                open={showAllTasks}
                transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
              >
                <BlockStack gap="200">
                  {items.map((item) => (
                    <ChecklistRow key={item.id} item={item} onCta={() => onCta(item)} />
                  ))}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <StatCard label="Locations" value={stats.locations} to="/app/locations" navigate={navigate} />
            <StatCard label="Zones" value={stats.zones} to="/app/zones" navigate={navigate} />
            <StatCard label="Active slots" value={stats.slots} to="/app/orders" navigate={navigate} />
            <StatCard label="Total bookings" value={stats.orders} to="/app/orders" navigate={navigate} />
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Tools</Text>
              <InlineStack gap="200" wrap>
                <Button onClick={() => navigate("/app/settings")}>Settings</Button>
                <Button onClick={() => navigate("/app/setup?step=1")}>Setup wizard</Button>
                <Button onClick={() => navigate("/app/diagnostics")}>Diagnostics</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function ChecklistRow({ item, onCta }: { item: ChecklistItem; onCta: () => void }) {
  return (
    <InlineStack
      align="space-between"
      blockAlign="center"
      wrap={false}
      gap="400"
    >
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <StatusDot done={item.done} manual={item.manual === true} />
        <BlockStack gap="050">
          <Text as="p" fontWeight={item.done ? "regular" : "semibold"}>
            {item.label}
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {item.description}
          </Text>
        </BlockStack>
      </InlineStack>
      <Button
        onClick={onCta}
        variant={item.done ? "secondary" : "primary"}
        size="slim"
      >
        {item.cta.label}
      </Button>
    </InlineStack>
  );
}

function StatusDot({ done, manual }: { done: boolean; manual: boolean }) {
  if (done) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 11,
          background: "#1a8917",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 22,
        height: 22,
        borderRadius: 11,
        border: manual
          ? "2px dashed var(--p-color-border, #b5b5b5)"
          : "2px solid var(--p-color-border, #b5b5b5)",
      }}
    />
  );
}

function StatCard({
  label,
  value,
  to,
  navigate,
}: {
  label: string;
  value: number;
  to: string;
  navigate: (to: string) => void;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="headingXl">{value}</Text>
        <Text as="p" tone="subdued">{label}</Text>
        <Button onClick={() => navigate(to)} size="slim">View</Button>
      </BlockStack>
    </Card>
  );
}
