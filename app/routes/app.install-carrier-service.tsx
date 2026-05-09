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
  listCarrierServices,
  registerCarrierService,
  updateCarrierService,
} from "../services/carrier-service.server";
import { getEnv } from "../utils/env.server";

interface Status {
  ok: boolean;
  message: string;
  carrierServiceId?: string;
  callbackUrl?: string;
  active?: boolean;
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

    const callbackUrl = buildCallbackUrl(getEnv().SHOPIFY_APP_URL);

    // Always list first. Three reasons:
    // 1. Stored carrierServiceId might be stale (merchant deleted it).
    // 2. A previous install (different tunnel URL, different env) may
    //    have left a same-name registration we'd otherwise fail to
    //    create over — adopt it instead of asking the merchant to
    //    delete-and-retry.
    // 3. Lets us refresh the callbackUrl when adopting (common case:
    //    dev tunnel URL changed between sessions).
    const existing = await listCarrierServices(admin.graphql);
    const byStoredId = shop.carrierServiceId
      ? existing.find((c) => c.id === shop.carrierServiceId)
      : undefined;
    const byName = existing.find((c) => c.name === CARRIER_SERVICE_NAME);
    const adoptable = byStoredId ?? byName;

    if (adoptable) {
      // Refresh callbackUrl + active flag so the existing registration
      // points at this app's current tunnel and is on. No-op if Shopify
      // already has the same values.
      const refreshed =
        adoptable.callbackUrl === callbackUrl && adoptable.active
          ? adoptable
          : (await updateCarrierService(admin.graphql, adoptable.id, callbackUrl)) ?? adoptable;

      if (shop.carrierServiceId !== refreshed.id) {
        await prisma.shop.update({
          where: { id: shop.id },
          data: { carrierServiceId: refreshed.id },
        });
      }

      return json<Status>({
        ok: refreshed.active !== false,
        message:
          refreshed.active === false
            ? `Adopted existing "${CARRIER_SERVICE_NAME}" registration but Shopify reports it as INACTIVE. Activate via Admin → Settings → Shipping & delivery → Carrier accounts.`
            : adoptable.callbackUrl !== callbackUrl
              ? `Adopted existing "${CARRIER_SERVICE_NAME}" registration and refreshed its callback URL.`
              : `Already registered and active.`,
        carrierServiceId: refreshed.id,
        callbackUrl: refreshed.callbackUrl,
        active: refreshed.active !== false,
      });
    }

    // Nothing to adopt — create from scratch.
    const result = await registerCarrierService(admin.graphql, callbackUrl);
    if (!result.ok) {
      // Surface Shopify's actual error verbatim. The most common one in
      // practice ("Carrier Calculated Shipping must be enabled for your
      // store before enabling: Ordak Go") tells the merchant exactly
      // which Partners-Dashboard feature flag to flip — without that
      // hint they'd have no way to act.
      const ccsHint = /Carrier Calculated Shipping must be enabled/i.test(result.error)
        ? " — In the Shopify Partners Dashboard, open this store, find the 'Carrier-calculated shipping' feature, and enable it. Then retry this page."
        : "";
      return json<Status>({
        ok: false,
        message: `Registration failed: ${result.error}.${ccsHint}`,
      });
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: { carrierServiceId: result.record.id },
    });

    return json<Status>({
      ok: result.record.active,
      message: result.record.active
        ? `Registered "${CARRIER_SERVICE_NAME}" successfully.`
        : `Registered "${CARRIER_SERVICE_NAME}" but Shopify returned active=false. Custom rates will not appear at checkout until activated.`,
      carrierServiceId: result.record.id,
      callbackUrl: result.record.callbackUrl,
      active: result.record.active,
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
    <Page title="Install carrier service" backAction={{ content: "Settings", url: "/app/settings" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Banner tone={status.ok ? "success" : "critical"}>
                <Text as="p">{status.message}</Text>
              </Banner>
              {status.carrierServiceId ? (
                <BlockStack gap="050">
                  <Text as="p">
                    Carrier service ID: <code>{status.carrierServiceId}</code>
                  </Text>
                  {status.active === false ? (
                    <Text as="p" tone="critical">
                      ⚠ Inactive — activate via Admin → Settings → Shipping & delivery → Carrier accounts
                    </Text>
                  ) : null}
                </BlockStack>
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
