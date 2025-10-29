import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  return json({
    shop: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
  });
}

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <Page title="ordakGov2 - Delivery & Pickup Scheduler">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Welcome to ordakGov2! 🎉
              </Text>
              <Text as="p">
                Your Shopify app for managing delivery and pickup scheduling with intelligent recommendations.
              </Text>
              <Text as="p" tone="subdued">
                Connected to: {shop}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Quick Start
              </Text>
              <Text as="p">
                1. Set up your locations
              </Text>
              <Text as="p">
                2. Define delivery zones
              </Text>
              <Text as="p">
                3. Configure scheduling rules
              </Text>
              <Text as="p">
                4. Enable recommendations
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Features
              </Text>
              <Text as="p">
                ✓ Delivery/Pickup toggle
              </Text>
              <Text as="p">
                ✓ Postcode eligibility
              </Text>
              <Text as="p">
                ✓ Calendar & time slots
              </Text>
              <Text as="p">
                ✓ Smart recommendations
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
