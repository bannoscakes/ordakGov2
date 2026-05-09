// One-shot install page for the delivery_customization Function.
//
// Phase D will replace this with a proper admin UI surface, but for now this
// loader runs the install via authenticate.admin (which gets a fresh token
// via token-exchange) so the merchant can self-install with a single visit.
// Idempotent: detects an existing installation and just reports status.

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Banner, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

interface Status {
  ok: boolean;
  message: string;
  customizationId?: string;
  enabled?: boolean;
  functionId?: string;
}

// Shape we re-cast Shopify's GraphQL response into so we can read the
// top-level `errors` field — the SDK's typed wrapper doesn't expose it.
interface GqlBody<T = Record<string, unknown>> {
  data?: T | null;
  errors?: Array<{ message: string }>;
}

interface FunctionsData {
  shopifyFunctions?: {
    nodes?: Array<{ id: string; title: string; apiType: string; app?: { title?: string } }>;
  };
}

interface DeliveryCustomizationsData {
  deliveryCustomizations?: {
    nodes?: Array<{ id: string; title: string; functionId: string; enabled: boolean }>;
  };
}

const FUNCTION_TITLE = "Ordak Go — hide rates by cart-stage choice";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  try {
    const fnRes = await admin.graphql(
      `#graphql
        query OrdakGoFunctions {
          shopifyFunctions(first: 25) {
            nodes { id title apiType app { title } }
          }
        }`,
    );
    // Top-level GraphQL errors (scope missing, throttled, schema drift)
    // surface at `errors`, not at `data.*.userErrors`. The SDK's
    // FetchResponseBody type doesn't include the `errors` field, so
    // re-type to `GqlBody`. Without this check, a missing scope renders
    // as "No delivery_customization Function found" — wrong action item.
    const fnBody = (await fnRes.json()) as GqlBody<FunctionsData>;
    if (Array.isArray(fnBody.errors) && fnBody.errors.length > 0) {
      return json<Status>({
        ok: false,
        message: `GraphQL error querying functions: ${fnBody.errors.map((e) => e.message).join(", ")}`,
      });
    }
    const ours = fnBody.data?.shopifyFunctions?.nodes?.find(
      (f) => f.apiType === "delivery_customization" && f.app?.title === "Ordak Go",
    );
    if (!ours) {
      return json<Status>({
        ok: false,
        message:
          "No delivery_customization Function found for Ordak Go. Re-run `shopify app deploy` then refresh this page.",
      });
    }

    const existingRes = await admin.graphql(
      `#graphql
        query OrdakGoExistingCustomizations {
          deliveryCustomizations(first: 25) {
            nodes { id title functionId enabled }
          }
        }`,
    );
    const existingBody = (await existingRes.json()) as GqlBody<DeliveryCustomizationsData>;
    if (Array.isArray(existingBody.errors) && existingBody.errors.length > 0) {
      return json<Status>({
        ok: false,
        message: `GraphQL error querying customizations: ${existingBody.errors.map((e) => e.message).join(", ")}`,
      });
    }
    const dup = existingBody.data?.deliveryCustomizations?.nodes?.find(
      (c) => c.functionId === ours.id,
    );
    if (dup) {
      if (!dup.enabled) {
        const updateRes = await admin.graphql(
          `#graphql
            mutation OrdakGoEnableDC($id: ID!, $deliveryCustomization: DeliveryCustomizationInput!) {
              deliveryCustomizationUpdate(id: $id, deliveryCustomization: $deliveryCustomization) {
                deliveryCustomization { id enabled }
                userErrors { field message }
              }
            }`,
          { variables: { id: dup.id, deliveryCustomization: { enabled: true } } },
        );
        const updateBody = await updateRes.json();
        const updateErrs = updateBody.data?.deliveryCustomizationUpdate?.userErrors ?? [];
        if (updateErrs.length) {
          return json<Status>({
            ok: false,
            message: `Enable failed: ${updateErrs.map((e: { message: string }) => e.message).join(", ")}`,
            customizationId: dup.id,
            enabled: false,
            functionId: ours.id,
          });
        }
        const updated = updateBody.data?.deliveryCustomizationUpdate?.deliveryCustomization;
        return json<Status>({
          ok: true,
          message: "Re-enabled existing installation.",
          customizationId: dup.id,
          enabled: updated?.enabled ?? true,
          functionId: ours.id,
        });
      }
      return json<Status>({
        ok: true,
        message: "Already installed.",
        customizationId: dup.id,
        enabled: true,
        functionId: ours.id,
      });
    }

    const createRes = await admin.graphql(
      `#graphql
        mutation OrdakGoCreateDC($deliveryCustomization: DeliveryCustomizationInput!) {
          deliveryCustomizationCreate(deliveryCustomization: $deliveryCustomization) {
            deliveryCustomization { id title enabled functionId }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          deliveryCustomization: {
            functionId: ours.id,
            title: FUNCTION_TITLE,
            enabled: true,
          },
        },
      },
    );
    const createBody = await createRes.json();
    const errs = createBody.data?.deliveryCustomizationCreate?.userErrors ?? [];
    if (errs.length) {
      return json<Status>({
        ok: false,
        message: `Create failed: ${errs.map((e: { message: string }) => e.message).join(", ")}`,
      });
    }
    const created = createBody.data.deliveryCustomizationCreate.deliveryCustomization;
    return json<Status>({
      ok: true,
      message: "Installed.",
      customizationId: created.id,
      enabled: created.enabled,
      functionId: ours.id,
    });
  } catch (err) {
    let message = "unknown";
    if (err instanceof Response) {
      try {
        const body = await err.json();
        message = JSON.stringify(body);
      } catch {
        message = `${err.status} ${err.statusText}`;
      }
    } else if (err instanceof Error) {
      message = err.message;
    } else {
      message = String(err);
    }
    return json<Status>({ ok: false, message: `Install error: ${message}` });
  }
}

export default function InstallDeliveryCustomization() {
  const status = useLoaderData<typeof loader>();
  return (
    <Page title="Install delivery customization" backAction={{ content: "Settings", url: "/app/settings" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Banner tone={status.ok ? "success" : "critical"}>
                <Text as="p">{status.message}</Text>
              </Banner>
              {status.customizationId ? (
                <BlockStack gap="100">
                  <Text as="p">
                    Customization ID: <code>{status.customizationId}</code>
                  </Text>
                  <Text as="p">
                    Function ID: <code>{status.functionId}</code>
                  </Text>
                  <Text as="p">
                    Enabled: <Badge tone={status.enabled ? "success" : "warning"}>{String(status.enabled)}</Badge>
                  </Text>
                </BlockStack>
              ) : null}
              <Text as="p" tone="subdued">
                Hides shipping rates that don't match the customer's cart-stage
                pickup vs delivery choice. View / disable at <strong>Settings → Shipping
                and delivery → Delivery customizations</strong>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
