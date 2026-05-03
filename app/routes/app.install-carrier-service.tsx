// One-shot install for the Carrier Service. Bridges the gap when the
// shop's afterAuth didn't fire (token-exchange refresh limitation —
// existing installs don't re-run afterAuth, so a freshly added carrier
// service registration never gets bootstrapped). Phase D will replace
// this with a reconciliation job that runs on every login.
//
// Idempotent: if a carrier service already exists for this shop (Shop
// row has carrierServiceId set), reports it without re-creating.

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  CARRIER_SERVICE_NAME,
  buildCallbackUrl,
  registerCarrierService,
} from "../services/carrier-service.server";
import { getEnv } from "../utils/env.server";

interface Status {
  ok: boolean;
  message: string;
  carrierServiceId?: string;
  callbackUrl?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
    });
    if (!shop) {
      return json<Status>({ ok: false, message: `No Shop row for ${session.shop}` });
    }

    if (shop.carrierServiceId) {
      // Verify it's actually still active in Shopify (a merchant could have
      // deleted it via admin without our knowing).
      const checkRes = await admin.graphql(
        `#graphql
          query OrdakGoCarrierServices {
            carrierServices(first: 25) {
              nodes { id name active }
            }
          }`,
      );
      const checkBody = await checkRes.json();
      const ours = checkBody.data?.carrierServices?.nodes?.find(
        (c: { id: string }) => c.id === shop.carrierServiceId,
      );
      if (ours) {
        return json<Status>({
          ok: true,
          message: "Already registered.",
          carrierServiceId: ours.id,
        });
      }
      // Stored id is stale — fall through to re-register.
    }

    const callbackUrl = buildCallbackUrl(getEnv().SHOPIFY_APP_URL);
    const result = await registerCarrierService(admin.graphql, callbackUrl);
    if (!result) {
      return json<Status>({
        ok: false,
        message:
          "Registration failed (check dev logs for the GraphQL error). Most common cause: a carrier service with the same name already exists — delete it via Admin → Settings → Shipping & delivery → Carrier accounts, then retry.",
      });
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: { carrierServiceId: result.id },
    });

    return json<Status>({
      ok: true,
      message: `Registered "${CARRIER_SERVICE_NAME}" successfully.`,
      carrierServiceId: result.id,
      callbackUrl: result.callbackUrl,
    });
  } catch (err) {
    let message = "unknown";
    if (err instanceof Response) {
      try {
        message = JSON.stringify(await err.json());
      } catch {
        message = `${err.status} ${err.statusText}`;
      }
    } else if (err instanceof Error) {
      message = err.message;
    }
    return json<Status>({ ok: false, message: `Install error: ${message}` });
  }
}

export default function InstallCarrierService() {
  const status = useLoaderData<typeof loader>();
  return (
    <Page title="Install carrier service">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Banner tone={status.ok ? "success" : "critical"}>
                <Text as="p">{status.message}</Text>
              </Banner>
              {status.carrierServiceId ? (
                <Text as="p">
                  Carrier service ID: <code>{status.carrierServiceId}</code>
                </Text>
              ) : null}
              {status.callbackUrl ? (
                <Text as="p" tone="subdued">
                  Shopify will POST rate requests to: <code>{status.callbackUrl}</code>
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
