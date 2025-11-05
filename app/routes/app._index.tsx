import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, Button, InlineStack, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    include: {
      locations: true,
      zones: true,
      rules: true,
      _count: {
        select: {
          orderLinks: true,
        },
      },
    },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  const isSetupComplete = shop.locations.length > 0 && shop.zones.length > 0;

  return json({
    shop: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    stats: {
      locations: shop.locations.length,
      zones: shop.zones.length,
      rules: shop.rules.filter((r) => r.isActive).length,
      totalOrders: shop._count.orderLinks,
      isSetupComplete,
    },
  });
}

export default function Index() {
  const { shop, stats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page title="Dashboard">
      <Layout>
        {/* Welcome Banner */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Welcome to Ordak! 🎉
                  </Text>
                  <Text as="p">
                    Your Shopify app for managing delivery and pickup scheduling with intelligent recommendations.
                  </Text>
                  <Text as="p" tone="subdued">
                    Connected to: {shop}
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

        {/* Setup Status Banner */}
        {!stats.isSetupComplete && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    Complete Your Setup
                  </Text>
                  <Badge tone="warning">Setup Incomplete</Badge>
                </InlineStack>
                <Text as="p">
                  Run the setup wizard to configure your first location, zone, and business rules.
                </Text>
                <Button onClick={() => navigate("/app/setup")}>Start Setup Wizard</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Quick Stats */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Quick Stats
            </Text>
            <InlineStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="headingXl">
                    {stats.locations}
                  </Text>
                  <Text as="p" tone="subdued">
                    Locations
                  </Text>
                  <Button size="slim" onClick={() => navigate("/app/locations")}>
                    Manage
                  </Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="headingXl">
                    {stats.zones}
                  </Text>
                  <Text as="p" tone="subdued">
                    Zones
                  </Text>
                  <Button size="slim" onClick={() => navigate("/app/zones")}>
                    Manage
                  </Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="headingXl">
                    {stats.rules}
                  </Text>
                  <Text as="p" tone="subdued">
                    Active Rules
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="headingXl">
                    {stats.totalOrders}
                  </Text>
                  <Text as="p" tone="subdued">
                    Total Bookings
                  </Text>
                  <Button size="slim" onClick={() => navigate("/app/orders")}>
                    View
                  </Button>
                </BlockStack>
              </Card>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        {/* Management Tools */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Management Tools
            </Text>
            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      📦 Orders
                    </Text>
                    <Text as="p" variant="bodySm">
                      View and manage customer bookings. Reschedule or cancel orders as needed.
                    </Text>
                    <Button onClick={() => navigate("/app/orders")}>View Orders</Button>
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      🔍 Diagnostics
                    </Text>
                    <Text as="p" variant="bodySm">
                      Troubleshoot why customers might not see available slots.
                    </Text>
                    <Button onClick={() => navigate("/app/diagnostics")}>Run Diagnostics</Button>
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      ⚙️ Setup Wizard
                    </Text>
                    <Text as="p" variant="bodySm">
                      Guided setup for configuring locations, zones, and rules.
                    </Text>
                    <Button onClick={() => navigate("/app/setup")}>Run Setup</Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Layout.Section>

        {/* Configuration */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Configuration
            </Text>
            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      📍 Locations
                    </Text>
                    <Text as="p" variant="bodySm">
                      Manage warehouses, stores, and pickup points.
                    </Text>
                    <InlineStack gap="200">
                      <Button onClick={() => navigate("/app/locations")}>View All</Button>
                      <Button variant="primary" onClick={() => navigate("/app/locations/new")}>
                        Add New
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      🗺️ Zones
                    </Text>
                    <Text as="p" variant="bodySm">
                      Define delivery areas and pickup zones.
                    </Text>
                    <InlineStack gap="200">
                      <Button onClick={() => navigate("/app/zones")}>View All</Button>
                      <Button variant="primary" onClick={() => navigate("/app/zones/new")}>
                        Add New
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      🤖 Recommendations
                    </Text>
                    <Text as="p" variant="bodySm">
                      Configure AI-powered recommendation weights.
                    </Text>
                    <Button onClick={() => navigate("/app/settings/recommendations")}>
                      Configure
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Layout.Section>

        {/* Features List */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Platform Features
              </Text>
              <Layout>
                <Layout.Section variant="oneHalf">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      Customer Experience
                    </Text>
                    <Text as="p">✓ Delivery/Pickup toggle</Text>
                    <Text as="p">✓ Postcode eligibility checking</Text>
                    <Text as="p">✓ Calendar & time slot selection</Text>
                    <Text as="p">✓ Smart slot recommendations</Text>
                    <Text as="p">✓ Self-service rescheduling</Text>
                  </BlockStack>
                </Layout.Section>

                <Layout.Section variant="oneHalf">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      Admin Capabilities
                    </Text>
                    <Text as="p">✓ Multi-location management</Text>
                    <Text as="p">✓ Zone configuration</Text>
                    <Text as="p">✓ Business rules (cutoffs, lead times)</Text>
                    <Text as="p">✓ Order rescheduling & cancellation</Text>
                    <Text as="p">✓ Diagnostic troubleshooting</Text>
                  </BlockStack>
                </Layout.Section>
              </Layout>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
