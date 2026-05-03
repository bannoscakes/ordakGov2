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
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    include: {
      locations: { select: { id: true } },
      zones: { select: { id: true } },
      rules: { select: { id: true, isActive: true } },
    },
  });

  const locationCount = shop?.locations.length ?? 0;
  const zoneCount = shop?.zones.length ?? 0;
  const activeRuleCount = shop?.rules.filter((r) => r.isActive).length ?? 0;
  const orderCount = shop
    ? await prisma.orderLink.count({
        where: { slot: { location: { shopId: shop.id } } },
      })
    : 0;

  return json({
    shop: session.shop,
    stats: {
      locations: locationCount,
      zones: zoneCount,
      activeRules: activeRuleCount,
      orders: orderCount,
      isSetupComplete: locationCount > 0 && zoneCount > 0,
    },
  });
}

export default function Index() {
  const { shop, stats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page title="Dashboard">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Welcome to Ordak Go
                  </Text>
                  <Text as="p" tone="subdued">
                    Connected to {shop}
                  </Text>
                </BlockStack>
                {!stats.isSetupComplete && (
                  <Button variant="primary" onClick={() => navigate("/app/setup")}>
                    Run Setup Wizard
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {!stats.isSetupComplete && (
          <Layout.Section>
            <Banner tone="warning" title="Setup incomplete">
              <p>
                Add at least one location and one zone to start accepting bookings.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="headingXl">{stats.locations}</Text>
                <Text as="p" tone="subdued">Locations</Text>
                <Button onClick={() => navigate("/app/locations")}>Manage</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="headingXl">{stats.zones}</Text>
                <Text as="p" tone="subdued">Zones</Text>
                <Button onClick={() => navigate("/app/zones")}>Manage</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="headingXl">{stats.activeRules}</Text>
                <Text as="p" tone="subdued">Active rules</Text>
                <Button onClick={() => navigate("/app/rules")}>Manage</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="headingXl">{stats.orders}</Text>
                <Text as="p" tone="subdued">Total bookings</Text>
                <Button onClick={() => navigate("/app/orders")}>View</Button>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">Tools</Text>
              <InlineStack gap="400" wrap>
                <Button onClick={() => navigate("/app/setup")}>Setup wizard</Button>
                <Button onClick={() => navigate("/app/diagnostics")}>Diagnostics</Button>
                <Button onClick={() => navigate("/app/settings/recommendations")}>
                  Recommendation settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
