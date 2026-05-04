import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

const SECTIONS = [
  {
    id: "general",
    title: "General configurations",
    description: "Timezone, default lead time, and shop-wide scheduling defaults.",
    href: "/app/settings/general",
  },
  {
    id: "widget-appearance",
    title: "Widget appearance",
    description:
      "Show or hide the RECOMMENDED and Most-available-capacity badges on cart-block slot tiles.",
    href: "/app/settings/widget-appearance",
  },
  {
    id: "integrations",
    title: "Integrations",
    description:
      "Webhook destinations for external systems (delivery routing, ERP). Install routes for the Carrier Service, Delivery Customization, and Cart Validation Functions.",
    href: "/app/settings/integrations",
  },
  {
    id: "checkout-rules",
    title: "Checkout rules",
    description:
      "Toggles for the rules the Cart Validation Function enforces (require date+slot, require valid zone match).",
    href: "/app/settings/checkout-rules",
  },
];

export default function SettingsIndex() {
  const navigate = useNavigate();
  return (
    <Page title="Settings" backAction={{ content: "Dashboard", url: "/app" }}>
      <Layout>
        {SECTIONS.map((s) => (
          <Layout.Section key={s.id}>
            <Card>
              <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">{s.title}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {s.description}
                  </Text>
                </BlockStack>
                <Button onClick={() => navigate(s.href)}>Edit</Button>
              </InlineStack>
            </Card>
          </Layout.Section>
        ))}
      </Layout>
    </Page>
  );
}
