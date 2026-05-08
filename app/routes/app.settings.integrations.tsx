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
        <Layout.AnnotatedSection
          title="Shopify Functions"
          description="Three Functions enforce scheduling at Shopify's checkout layer. Each install route is idempotent."
        >
          <Card>
            <BlockStack gap="400">
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
              {/* Cart validation Function is deployed but not user-installable
                  while the app distributes via custom-app — Shopify gates
                  validationCreate behind Plus for non-listed apps. The
                  hide-express-buttons toggle on the cart-scheduler-embed
                  (theme editor → App embeds) covers the same surface via CSS
                  on every plan. The Function auto-activates as defense-in-depth
                  once the app is App-Store distributed, at which point this
                  install row can come back. */}
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.AnnotatedSection
          title="Webhook destinations"
          description="Push order events to external systems like delivery routing or ERP."
        >
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" fontWeight="semibold">Configured destinations</Text>
                <Badge tone={webhookDestinationCount > 0 ? "success" : undefined}>
                  {webhookDestinationCount > 0
                    ? `${webhookDestinationCount} configured`
                    : "Not configured"}
                </Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Each destination receives signed POST requests for matching events. Failures are
                tracked per destination so a broken receiver surfaces here, not silently in your
                downstream pipeline.
              </Text>
              <InlineStack gap="200">
                <Button onClick={() => navigate("/app/settings/webhook-destinations")}>
                  {webhookDestinationCount > 0 ? "Manage destinations" : "Add a destination"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.AnnotatedSection
          title="Webhook subscriptions"
          description="Re-register Shopify → Ordak Go webhooks if delivery stopped firing."
        >
          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                Idempotent. Run this if you've added new event topics or webhook delivery has
                stopped firing.
              </Text>
              <InlineStack>
                <Button onClick={() => navigate("/app/install-webhooks")}>Re-register webhooks</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>
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
