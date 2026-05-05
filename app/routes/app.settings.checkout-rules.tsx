import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

const RULES = [
  {
    id: "delivery-method",
    label: "Require Delivery / Pickup choice",
    description: "Customer must pick delivery or pickup in the cart before checkout.",
    enforcedBy: "Cart Validation Function",
  },
  {
    id: "slot",
    label: "Require date + slot selection",
    description: "Customer must pick a date and time slot before checkout.",
    enforcedBy: "Cart Validation Function",
  },
  {
    id: "zone",
    label: "Require valid zone match for delivery",
    description: "Customer's delivery postcode must match an active zone with a non-zero base price.",
    enforcedBy: "Carrier Service callback",
  },
  {
    id: "fast-checkout",
    label: "Block fast checkout (Shop Pay, Apple Pay, Buy-it-now) when scheduling missing",
    description: "Express checkout buttons skip the cart UI; the validation function blocks them at Shopify's checkout layer.",
    enforcedBy: "Cart Validation Function",
  },
];

export default function CheckoutRules() {
  return (
    <Page
      title="Checkout rules"
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            All rules are currently enforced — there are no toggles to disable them in v1. The
            page lists what's in effect so the merchant knows what protections are active.
            Per-rule on/off toggles are deferred until a real merchant requests them.
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Active rules</Text>
              <BlockStack gap="300">
                {RULES.map((r) => (
                  <InlineStack
                    key={r.id}
                    align="space-between"
                    blockAlign="center"
                    gap="400"
                    wrap={false}
                  >
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">{r.label}</Text>
                      <Text as="p" tone="subdued" variant="bodySm">{r.description}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Enforced by: <code>{r.enforcedBy}</code>
                      </Text>
                    </BlockStack>
                    <Badge tone="success">Active</Badge>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
