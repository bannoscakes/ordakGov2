import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  ProgressBar,
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
        locations: {
          select: { id: true, name: true, isActive: true },
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
    const themeEditorUrl = `https://admin.shopify.com/store/${session.shop.replace(
      ".myshopify.com",
      "",
    )}/themes/current/editor`;

    return json({
      shop: session.shop,
      themeEditorUrl,
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
  const { shop, themeEditorUrl, stats, checklist } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

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
    {
      id: "validation",
      label: "Activate cart validation",
      description: "Blocks Shop Pay / Apple Pay express checkout when scheduling is missing.",
      done: false,
      manual: true,
      cta: { label: "Install", to: "/app/install-cart-validation" },
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
      label: "Embed cart-block in your theme",
      description: "Add the Ordak Go block to your cart template via the theme editor.",
      done: false,
      manual: true,
      // External link: the theme editor lives at admin.shopify.com, not
      // inside the embedded Remix iframe. Routing via Remix navigate would
      // 404 inside the iframe.
      cta: { label: "Open theme editor", to: themeEditorUrl, external: true },
    },
  ];

  const autoTracked = items.filter((i) => !i.manual);
  const completedCount = autoTracked.filter((i) => i.done).length;
  const totalCount = autoTracked.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const setupComplete = totalCount > 0 && completedCount === totalCount;

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

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Setup guide</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {setupComplete
                      ? "Core setup complete. The manual steps below are also worth ticking off before going live."
                      : `${completedCount} of ${totalCount} core steps complete`}
                  </Text>
                </BlockStack>
                <Badge tone={setupComplete ? "success" : undefined}>
                  {setupComplete ? "Ready" : `${completedCount}/${totalCount}`}
                </Badge>
              </InlineStack>
              <ProgressBar progress={progressPct} size="small" />
              <BlockStack gap="200">
                {items.map((item) => (
                  <ChecklistRow key={item.id} item={item} onCta={() => onCta(item)} />
                ))}
              </BlockStack>
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
