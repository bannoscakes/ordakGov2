import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Icon,
  Box,
  Divider,
} from "@shopify/polaris";
import {
  StoreIcon,
  DeliveryIcon,
  HomeIcon,
  ColorIcon,
  ThemeEditIcon,
  ConnectIcon,
  SettingsIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  WrenchIcon,
  RefreshIcon,
  DataPresentationIcon,
  PersonIcon,
  ResetIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      locations: {
        where: { isActive: true },
        select: { id: true, supportsPickup: true },
      },
      zones: {
        where: { isActive: true },
        select: { id: true },
      },
      webhookDestinations: {
        where: { enabled: true },
        select: { id: true },
      },
    },
  });
  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }
  const pickupLocationCount = shop.locations.filter((l) => l.supportsPickup).length;
  const deliveryZoneCount = shop.zones.length;
  const integrationsCount = shop.webhookDestinations.length;
  const shopHandle = session.shop.replace(".myshopify.com", "");
  const themeEditorUrl =
    `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?context=apps`;
  return json({
    pickupLocationCount,
    deliveryZoneCount,
    integrationsCount,
    themeEditorUrl,
  });
}

export default function SettingsIndex() {
  const {
    pickupLocationCount,
    deliveryZoneCount,
    integrationsCount,
    themeEditorUrl,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page title="Settings" backAction={{ content: "Dashboard", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">General</Text>
            <InlineStack gap="400" wrap>
              <FeatureCard
                icon={StoreIcon}
                title="Store pickup"
                description="Manage pickup locations and per-location pickup hours."
                badge={
                  pickupLocationCount > 0
                    ? { tone: "success", label: "Enabled" }
                    : { tone: undefined, label: "Disabled" }
                }
                onClick={() => navigate("/app/locations")}
              />
              <FeatureCard
                icon={DeliveryIcon}
                title="Local delivery"
                description="Manage delivery zones, slots, and zone pricing."
                badge={
                  deliveryZoneCount > 0
                    ? { tone: "success", label: `${deliveryZoneCount} zone${deliveryZoneCount === 1 ? "" : "s"}` }
                    : { tone: undefined, label: "Not configured" }
                }
                onClick={() => navigate("/app/zones")}
              />
              <FeatureCard
                icon={HomeIcon}
                title="Shipping"
                description="Configure carrier-calculated shipping rates."
                badge={{ tone: "info", label: "Manual" }}
                onClick={() => navigate("/app/setup-au-shipping")}
              />
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Advanced</Text>
            <Card padding="0">
              <BlockStack gap="0">
                <ActionRow
                  icon={SettingsIcon}
                  title="General configurations"
                  description="Per-location timezones and email notification defaults."
                  onClick={() => navigate("/app/settings/general")}
                />
                <Divider />
                <ActionRow
                  icon={ColorIcon}
                  title="Appearance"
                  description="Customize widget badges and tile layout."
                  onClick={() => navigate("/app/settings/widget-appearance")}
                />
                <Divider />
                <ActionRow
                  icon={CheckCircleIcon}
                  title="Checkout rules"
                  description="Decide what's required at checkout — date, slot, valid delivery zone."
                  onClick={() => navigate("/app/settings/checkout-rules")}
                />
                <Divider />
                <ActionRow
                  icon={ThemeEditIcon}
                  title="Themes and checkouts"
                  description="Install cart, checkout, and order status widgets in the theme editor."
                  external
                  onClick={() => window.open(themeEditorUrl, "_top")}
                />
                <Divider />
                <ActionRow
                  icon={ConnectIcon}
                  title="Integrations"
                  description="Webhook destinations and Shopify Function installs."
                  badge={
                    integrationsCount > 0
                      ? { tone: "success", label: "Active" }
                      : { tone: undefined, label: "Not configured" }
                  }
                  onClick={() => navigate("/app/settings/integrations")}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Diagnostics and maintenance</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Tools for verifying the app is wired up correctly and resolving
              data-handling requests. Routine merchants don't need these.
            </Text>
            <Card padding="0">
              <BlockStack gap="0">
                <ActionRow
                  icon={WrenchIcon}
                  title="Slot diagnostics"
                  description="Trace why a particular date or postcode is or isn't returning slots."
                  onClick={() => navigate("/app/diagnostics")}
                />
                <Divider />
                <ActionRow
                  icon={DataPresentationIcon}
                  title="Carrier-calculated shipping check"
                  description="Verify the carrier service is registered and the shop is on a CCS-eligible plan."
                  onClick={() => navigate("/app/check-ccs")}
                />
                <Divider />
                <ActionRow
                  icon={RefreshIcon}
                  title="Backfill orders"
                  description="Re-import the last 10 orders that don't yet have an Ordak Go schedule link."
                  onClick={() => navigate("/app/backfill-orders")}
                />
                <Divider />
                <ActionRow
                  icon={ResetIcon}
                  title="Clean up shipping zones"
                  description="Remove duplicate Ordak Go shipping rates left behind by previous installs."
                  onClick={() => navigate("/app/cleanup-shipping-zones")}
                />
                <Divider />
                <ActionRow
                  icon={PersonIcon}
                  title="Customer data export (GDPR)"
                  description="Export a customer's stored data in response to a customers/data_request webhook."
                  onClick={() => navigate("/app/data-requests")}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

type BadgeTone = "success" | "info" | "warning" | "critical" | "attention" | undefined;

// Native <button> wrapper that strips browser default styling so the visual
// design is fully delegated to the inner Polaris components. Using a real
// <button> rather than <div role="button"> gives us focus-ring, keyboard
// activation (Enter and Space), and correct screen-reader semantics for
// free — Polaris's accessibility audit flags the div pattern in App Store
// review.
function PressableShell({
  onClick,
  ariaLabel,
  fullFlex,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  fullFlex?: boolean;
  children: any;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        appearance: "none",
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        font: "inherit",
        color: "inherit",
        textAlign: "inherit",
        width: "100%",
        cursor: "pointer",
        borderRadius: "var(--p-border-radius-300, 12px)",
        ...(fullFlex ? { flex: "1 1 240px", minWidth: 240 } : {}),
      }}
    >
      {children}
    </button>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  badge,
  onClick,
}: {
  icon: any;
  title: string;
  description: string;
  badge: { tone: BadgeTone; label: string };
  onClick: () => void;
}) {
  return (
    <PressableShell onClick={onClick} ariaLabel={`${title}: ${description}`} fullFlex>
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="300" blockAlign="center" wrap={false} align="space-between">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Box>
                <Icon source={icon} tone="base" />
              </Box>
              <Text as="h3" variant="headingSm">{title}</Text>
            </InlineStack>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodySm">
            {description}
          </Text>
        </BlockStack>
      </Card>
    </PressableShell>
  );
}

function ActionRow({
  icon,
  title,
  description,
  badge,
  onClick,
}: {
  icon: any;
  title: string;
  description: string;
  badge?: { tone: BadgeTone; label: string };
  external?: boolean;
  onClick: () => void;
}) {
  return (
    <PressableShell onClick={onClick} ariaLabel={`${title}: ${description}`}>
      <Box padding="400">
        <InlineStack gap="400" blockAlign="center" wrap={false} align="space-between">
          <InlineStack gap="400" blockAlign="center" wrap={false}>
            <Box>
              <Icon source={icon} tone="base" />
            </Box>
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">{title}</Text>
                {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                {description}
              </Text>
            </BlockStack>
          </InlineStack>
          <Box>
            <Icon source={ChevronRightIcon} tone="subdued" />
          </Box>
        </InlineStack>
      </Box>
    </PressableShell>
  );
}
