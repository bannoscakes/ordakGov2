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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      carrierServiceId: true,
      webhookDestinations: { select: { id: true, url: true, enabled: true } },
    },
  });
  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }
  return json({
    carrierServiceRegistered: !!shop.carrierServiceId,
    webhookDestinationCount: shop.webhookDestinations.length,
  });
}

export default function SettingsIntegrations() {
  const { carrierServiceRegistered, webhookDestinationCount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page
      title="Integrations"
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Shopify Functions</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Three Functions enforce scheduling at Shopify's checkout layer. Each install
                route is idempotent — re-running it just confirms or re-enables the install.
              </Text>

              <InstallRow
                label="Carrier Service"
                description="Returns the delivery rate at checkout (zone basePrice + slot priceAdjustment)."
                status={carrierServiceRegistered ? "configured" : "unknown"}
                cta="Re-install"
                onCta={() => navigate("/app/install-carrier-service")}
              />
              <InstallRow
                label="Delivery customization"
                description="Hides shipping rates that don't match the cart-stage Pickup/Delivery choice."
                status="unknown"
                cta="Install / re-enable"
                onCta={() => navigate("/app/install-delivery-customization")}
              />
              <InstallRow
                label="Cart validation"
                description="Blocks Shop Pay / Apple Pay / Buy-it-now express checkout when scheduling attributes are missing."
                status="unknown"
                cta="Install / re-enable"
                onCta={() => navigate("/app/install-cart-validation")}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Webhook destinations</Text>
                <Badge tone={webhookDestinationCount > 0 ? "success" : undefined}>
                  {webhookDestinationCount > 0
                    ? `${webhookDestinationCount} configured`
                    : "Not configured"}
                </Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Push order/scheduling events to external systems (your delivery routing platform,
                ERP, etc.). Coming in a follow-up — schema reservation is in place; the admin UI
                and dispatcher runtime ship in D9.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Webhook subscriptions (Shopify → Ordak Go)</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Re-register Shopify webhooks if you've added new event topics or the delivery
                stopped firing. Idempotent.
              </Text>
              <InlineStack>
                <Button onClick={() => navigate("/app/install-webhooks")}>Re-register webhooks</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function InstallRow({
  label,
  description,
  status,
  cta,
  onCta,
}: {
  label: string;
  description: string;
  status: "configured" | "unknown";
  cta: string;
  onCta: () => void;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
      <BlockStack gap="100">
        <InlineStack gap="200" blockAlign="center">
          <Text as="p" fontWeight="semibold">{label}</Text>
          <Badge tone={status === "configured" ? "success" : undefined}>
            {status === "configured" ? "Configured" : "Status unknown"}
          </Badge>
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">{description}</Text>
      </BlockStack>
      <Button onClick={onCta} size="slim">{cta}</Button>
    </InlineStack>
  );
}
