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

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      locations: { select: { id: true, name: true } },
      zones: { select: { id: true, basePrice: true } },
    },
  });

  if (!shop) {
    return json({
      shop: session.shop,
      stats: { locations: 0, zones: 0, orders: 0, slots: 0 },
      checklist: emptyChecklist(),
    });
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

  const locationCount = shop.locations.length;
  const zoneCount = shop.zones.length;
  const zoneWithPriceCount = shop.zones.filter(
    (z) => Number(z.basePrice.toString()) > 0,
  ).length;
  const firstZoneId = shop.zones[0]?.id ?? null;
  const firstLocationId = shop.locations[0]?.id ?? null;

  return json({
    shop: session.shop,
    stats: {
      locations: locationCount,
      zones: zoneCount,
      slots: slotCount,
      orders: orderCount,
    },
    checklist: {
      locationCreated: locationCount > 0,
      zoneCreated: zoneCount > 0,
      zonePriceSet: zoneWithPriceCount > 0,
      timeSlotsConfigured: templateCount > 0,
      firstZoneId,
      firstLocationId,
    },
  });
}

function emptyChecklist() {
  return {
    locationCreated: false,
    zoneCreated: false,
    zonePriceSet: false,
    timeSlotsConfigured: false,
    firstZoneId: null,
    firstLocationId: null,
  };
}

type ChecklistItem = {
  id: string;
  label: string;
  description: string;
  done: boolean;
  // Items that we can't auto-track (theme embed, function installs).
  // Surfaced as informational steps the merchant ticks off via CTA but the
  // dashboard doesn't try to verify state on every load.
  manual?: boolean;
  cta: { label: string; to: string };
};

export default function Index() {
  const { shop, stats, checklist } = useLoaderData<typeof loader>();
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
      cta: { label: "Open theme editor", to: "/admin/themes/current/editor" },
    },
  ];

  // Auto-tracked progress only counts the four items the dashboard can
  // verify from the DB. Manual items (validation, delivery customization,
  // theme embed) sit alongside but don't move the bar.
  const autoTracked = items.filter((i) => !i.manual);
  const completedCount = autoTracked.filter((i) => i.done).length;
  const totalCount = autoTracked.length;
  const progressPct = (completedCount / totalCount) * 100;
  const setupComplete = completedCount === totalCount;

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
                  <ChecklistRow key={item.id} item={item} onCta={() => navigate(item.cta.to)} />
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
                <Button onClick={() => navigate("/app/setup")}>Setup wizard</Button>
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
