// One-shot install page for the cart-validation Function. Same shape as
// app.install-delivery-customization.tsx — finds the deployed function in
// the shop, creates a validation if none exists, or re-enables an existing
// disabled one. Idempotent.

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Banner, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

interface Status {
  ok: boolean;
  message: string;
  validationId?: string;
  enabled?: boolean;
  functionId?: string;
}

interface GqlBody<T = Record<string, unknown>> {
  data?: T | null;
  errors?: Array<{ message: string }>;
}

interface FunctionsData {
  shopifyFunctions?: {
    nodes?: Array<{ id: string; title: string; apiType: string; app?: { title?: string } }>;
  };
}

interface ValidationsData {
  validations?: {
    nodes?: Array<{ id: string; title: string; functionId: string; enabled: boolean }>;
  };
}

const VALIDATION_TITLE = "Ordak Go — block checkout without a delivery slot";

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
    const fnBody = (await fnRes.json()) as GqlBody<FunctionsData>;
    if (Array.isArray(fnBody.errors) && fnBody.errors.length > 0) {
      return json<Status>({
        ok: false,
        message: `GraphQL error querying functions: ${fnBody.errors.map((e) => e.message).join(", ")}`,
      });
    }
    const ours = fnBody.data?.shopifyFunctions?.nodes?.find(
      (f) => f.apiType === "validation" && f.app?.title === "Ordak Go",
    );
    if (!ours) {
      return json<Status>({
        ok: false,
        message:
          "No validation Function found for Ordak Go. Re-run `shopify app deploy` then refresh this page.",
      });
    }

    const existingRes = await admin.graphql(
      `#graphql
        query OrdakGoExistingValidations {
          validations(first: 25) {
            nodes { id title functionId enabled }
          }
        }`,
    );
    const existingBody = (await existingRes.json()) as GqlBody<ValidationsData>;
    if (Array.isArray(existingBody.errors) && existingBody.errors.length > 0) {
      return json<Status>({
        ok: false,
        message: `GraphQL error querying validations: ${existingBody.errors.map((e) => e.message).join(", ")}`,
      });
    }
    const dup = existingBody.data?.validations?.nodes?.find(
      (v) => v.functionId === ours.id,
    );
    if (dup) {
      if (!dup.enabled) {
        const updateRes = await admin.graphql(
          `#graphql
            mutation OrdakGoEnableValidation($id: ID!, $validation: ValidationUpdateInput!) {
              validationUpdate(id: $id, validation: $validation) {
                validation { id enabled }
                userErrors { field message }
              }
            }`,
          { variables: { id: dup.id, validation: { enable: true } } },
        );
        const updateBody = await updateRes.json();
        const updateErrs = updateBody.data?.validationUpdate?.userErrors ?? [];
        if (updateErrs.length) {
          return json<Status>({
            ok: false,
            message: `Enable failed: ${updateErrs.map((e: { message: string }) => e.message).join(", ")}`,
            validationId: dup.id,
            enabled: false,
            functionId: ours.id,
          });
        }
        const updated = updateBody.data?.validationUpdate?.validation;
        return json<Status>({
          ok: true,
          message: "Re-enabled existing installation.",
          validationId: dup.id,
          enabled: updated?.enabled ?? true,
          functionId: ours.id,
        });
      }
      return json<Status>({
        ok: true,
        message: "Already installed.",
        validationId: dup.id,
        enabled: true,
        functionId: ours.id,
      });
    }

    const createRes = await admin.graphql(
      `#graphql
        mutation OrdakGoCreateValidation($validation: ValidationCreateInput!) {
          validationCreate(validation: $validation) {
            validation { id title enabled functionId }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          validation: {
            functionId: ours.id,
            title: VALIDATION_TITLE,
            enable: true,
          },
        },
      },
    );
    const createBody = await createRes.json();
    const errs = createBody.data?.validationCreate?.userErrors ?? [];
    if (errs.length) {
      return json<Status>({
        ok: false,
        message: `Create failed: ${errs.map((e: { message: string }) => e.message).join(", ")}`,
      });
    }
    const created = createBody.data.validationCreate.validation;
    return json<Status>({
      ok: true,
      message: "Installed.",
      validationId: created.id,
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

export default function InstallCartValidation() {
  const status = useLoaderData<typeof loader>();
  return (
    <Page title="Install cart validation">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Banner tone={status.ok ? "success" : "critical"}>
                <Text as="p">{status.message}</Text>
              </Banner>
              {status.validationId ? (
                <BlockStack gap="100">
                  <Text as="p">
                    Validation ID: <code>{status.validationId}</code>
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
                Blocks checkout (including Shop Pay, Apple Pay, Google Pay,
                and Buy-it-now express buttons) when the cart doesn&apos;t have
                the required scheduling attributes. View / disable at{" "}
                <strong>Settings → Checkout</strong> in Shopify admin.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
