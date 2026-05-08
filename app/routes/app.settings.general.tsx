import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    include: {
      locations: { select: { id: true, name: true, timezone: true } },
    },
  });
  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }
  return json({ locations: shop.locations });
}

export default function SettingsGeneral() {
  const { locations } = useLoaderData<typeof loader>();
  return (
    <Page
      title="General configurations"
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            Most general settings live on each location's setup page. Edit a location to change
            its timezone, contact details, or fulfillment method support.
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Per-location timezones</Text>
              {locations.length === 0 ? (
                <Banner
                  tone="info"
                  action={{ content: "Add location", url: "/app/locations/new" }}
                >
                  No locations yet. Add one to start accepting delivery and pickup orders.
                </Banner>
              ) : (
                <BlockStack gap="200">
                  {locations.map((l) => (
                    <InlineStack key={l.id} gap="200" blockAlign="center" wrap>
                      <Badge>{l.timezone || "UTC"}</Badge>
                      <Text as="p"><b>{l.name}</b></Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Email notifications</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Order confirmation, shipping update, and pickup-ready emails are sent by Shopify
                directly. Customize them in <strong>Shopify admin → Settings → Notifications</strong>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
