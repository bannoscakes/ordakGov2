// Diagnostic-only: queries Shopify for the shop's plan + carrier service
// list so we can confirm whether Carrier-Calculated Shipping is the
// blocker. Read-only; safe to leave deployed (Partners Dashboard is the
// only place CCS itself can be toggled, this just reports what Shopify
// returns).

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Banner, InlineStack, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

interface CheckResult {
  shopDomain: string;
  plan: { displayName: string | null; partnerDevelopment: boolean | null; shopifyPlus: boolean | null };
  carrierServices: Array<{ id: string; name: string; callbackUrl: string; active: boolean }>;
  shippingProfiles: Array<{ id: string; name: string; default: boolean }>;
  graphqlErrors: unknown[] | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const res = await admin.graphql(
    `#graphql
      query OrdakGoCheckCcs {
        shop {
          myshopifyDomain
          plan { displayName partnerDevelopment shopifyPlus }
        }
        carrierServices(first: 25) {
          nodes { id name callbackUrl active }
        }
        deliveryProfiles(first: 5) {
          nodes { id name default }
        }
      }`,
  );
  const body = (await res.json()) as {
    data?: {
      shop?: { myshopifyDomain?: string; plan?: { displayName?: string; partnerDevelopment?: boolean; shopifyPlus?: boolean } };
      carrierServices?: { nodes?: Array<{ id: string; name: string; callbackUrl: string; active: boolean }> };
      deliveryProfiles?: { nodes?: Array<{ id: string; name: string; default: boolean }> };
    };
    errors?: unknown[];
  };

  return json<CheckResult>({
    shopDomain: session.shop,
    plan: {
      displayName: body.data?.shop?.plan?.displayName ?? null,
      partnerDevelopment: body.data?.shop?.plan?.partnerDevelopment ?? null,
      shopifyPlus: body.data?.shop?.plan?.shopifyPlus ?? null,
    },
    carrierServices: body.data?.carrierServices?.nodes ?? [],
    shippingProfiles: body.data?.deliveryProfiles?.nodes ?? [],
    graphqlErrors: Array.isArray(body.errors) && body.errors.length ? body.errors : null,
  });
}

export default function CheckCcs() {
  const r = useLoaderData<typeof loader>();
  const ccsLikelyEnabled = r.carrierServices.length > 0 || r.plan.shopifyPlus === true;

  return (
    <Page title="Carrier-calculated shipping diagnostic" backAction={{ content: "Settings", url: "/app/settings" }}>
      <Layout>
        <Layout.Section>
          <Banner tone={ccsLikelyEnabled ? "success" : "warning"}>
            <Text as="p">
              {ccsLikelyEnabled
                ? "CCS appears to be available. If install is still failing, the error message will be the source of truth."
                : "CCS does not appear to be enabled. If carrierServices is empty AND the install route returns 'Carrier Calculated Shipping must be enabled,' flip the toggle in Partners Dashboard for this dev store."}
            </Text>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Shop & plan</Text>
              <Text as="p"><b>Domain:</b> {r.shopDomain}</Text>
              <InlineStack gap="200">
                <Badge>{`Plan: ${r.plan.displayName ?? "unknown"}`}</Badge>
                <Badge tone={r.plan.partnerDevelopment ? "success" : undefined}>
                  {r.plan.partnerDevelopment ? "Dev store" : "Production store"}
                </Badge>
                <Badge tone={r.plan.shopifyPlus ? "success" : undefined}>
                  {r.plan.shopifyPlus ? "Plus" : "Non-Plus"}
                </Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">{`Carrier services (${r.carrierServices.length})`}</Text>
              {r.carrierServices.length === 0 ? (
                <Text as="p" tone="subdued">
                  None registered. If CCS is OFF, Shopify rejects every <code>carrierServiceCreate</code> with the
                  exact error you saw. Enabling CCS in the Partners Dashboard for this dev store unblocks install.
                </Text>
              ) : (
                r.carrierServices.map((c) => (
                  <BlockStack key={c.id} gap="050">
                    <Text as="p"><b>{c.name}</b> {c.active ? "✓ active" : "✗ inactive"}</Text>
                    <Text as="p" tone="subdued" variant="bodySm">id: <code>{c.id}</code></Text>
                    <Text as="p" tone="subdued" variant="bodySm">callback: <code>{c.callbackUrl}</code></Text>
                  </BlockStack>
                ))
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">{`Shipping profiles (${r.shippingProfiles.length})`}</Text>
              {r.shippingProfiles.map((p) => (
                <Text as="p" key={p.id}>
                  <b>{p.name}</b> {p.default ? "(default)" : ""} — <code>{p.id}</code>
                </Text>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        {r.graphqlErrors && (
          <Layout.Section>
            <Banner tone="critical" title="GraphQL errors">
              <pre style={{ fontSize: 11 }}>{JSON.stringify(r.graphqlErrors, null, 2)}</pre>
            </Banner>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
