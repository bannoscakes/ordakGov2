// GDPR data export tool for the merchant.
//
// When Shopify forwards a CUSTOMERS_DATA_REQUEST webhook to our handler
// at app/routes/webhooks.tsx, the handler logs receipt + counts in
// Vercel runtime logs. The merchant then comes here, enters the
// customer's email or Shopify customer id, and we re-run the data
// collection queries — same logic as the webhook handler — to produce
// a JSON export the merchant downloads and forwards to the customer.
//
// We deliberately don't snapshot the request to a DB table. The PII
// lives in tables queryable directly by customer email/id (OrderLink,
// CustomerPreferences, RecommendationLog), so a snapshot would just
// create a stale duplicate. Re-deriving on demand is the source of truth.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  TextField,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

interface ExportPayload {
  exportedAt: string;
  shop: string;
  query: { customerEmail: string | null; customerId: string | null };
  counts: {
    orderLinks: number;
    preferences: number;
    recommendationLogs: number;
  };
  data: {
    orderLinks: unknown[];
    preferences: unknown[];
    recommendationLogs: unknown[];
  };
}

interface LoaderData {
  shop: string;
  searchedEmail: string | null;
  searchedCustomerId: string | null;
  result: ExportPayload | null;
  error: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const customerEmail = (url.searchParams.get("customerEmail") || "").trim() || null;
  const customerId = (url.searchParams.get("customerId") || "").trim() || null;

  if (!customerEmail && !customerId) {
    return json<LoaderData>({
      shop: session.shop,
      searchedEmail: null,
      searchedCustomerId: null,
      result: null,
      error: null,
    });
  }

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      return json<LoaderData>({
        shop: session.shop,
        searchedEmail: customerEmail,
        searchedCustomerId: customerId,
        result: null,
        error: "Shop not found in our DB. Reinstall the app and retry.",
      });
    }

    // OrderLinks are scoped to slots whose location belongs to this shop.
    // We deliberately filter on shop scope here — without it, a bug
    // could leak orders from a different shop to whoever visits this
    // route. RecommendationLog filters via shopifyDomain (its native
    // shop scope).
    //
    // CustomerPreferences has NO shop scope in the schema — it's keyed
    // globally by customerId/customerEmail. If the same customer ever
    // shopped at two stores both running Ordak Go, naively returning
    // all their preferences would leak cross-shop data — a GDPR data
    // minimisation violation (each merchant is a separate data
    // controller and should only disclose data they hold).
    //
    // Mitigation without a schema migration: only return preferences
    // when the customer has at least one OrderLink at THIS shop. If
    // they do, we can claim the preference rows are "data this shop
    // contributed to" because the customer interacted with this shop.
    // It's not perfect — a preference row aggregated from multiple
    // shops would still leak the aggregate — but it closes the case
    // where the customer has no relationship with this shop at all.
    const emailOrId: Array<{ customerEmail: string } | { customerId: string }> = [];
    if (customerEmail) emailOrId.push({ customerEmail });
    if (customerId) emailOrId.push({ customerId });

    // Defensive: emailOrId can't be empty here because of the early-return
    // guard above. Assert so a future refactor that relaxes the guard
    // gets a loud failure instead of `OR: []` which has engine-dependent
    // behavior in Prisma.
    if (emailOrId.length === 0) {
      throw new Error(
        "data-requests: emailOrId must have at least one entry — check the early-return guard",
      );
    }

    const [orderLinks, recommendationLogs] = await Promise.all([
      customerEmail
        ? prisma.orderLink.findMany({
            where: {
              customerEmail,
              slot: { location: { shopId: shop.id } },
            },
            include: { slot: { include: { location: true } } },
          })
        : Promise.resolve([]),
      prisma.recommendationLog.findMany({
        where: {
          AND: [{ shopifyDomain: session.shop }, { OR: emailOrId }],
        },
      }),
    ]);

    // Only include preferences if the customer has at least one
    // OrderLink at this shop OR at least one RecommendationLog at this
    // shop. Otherwise the customer has no relationship with this shop
    // and the merchant has no standing to disclose preferences.
    const customerHasShopHistory = orderLinks.length > 0 || recommendationLogs.length > 0;
    const preferences = customerHasShopHistory
      ? await prisma.customerPreferences.findMany({
          where: { shopId: shop.id, OR: emailOrId },
        })
      : [];

    const result: ExportPayload = {
      exportedAt: new Date().toISOString(),
      shop: session.shop,
      query: { customerEmail, customerId },
      counts: {
        orderLinks: orderLinks.length,
        preferences: preferences.length,
        recommendationLogs: recommendationLogs.length,
      },
      data: {
        orderLinks: orderLinks.map((o) => ({
          id: o.id,
          shopifyOrderId: o.shopifyOrderId,
          shopifyOrderNumber: o.shopifyOrderNumber,
          fulfillmentType: o.fulfillmentType,
          customerEmail: o.customerEmail,
          customerPhone: o.customerPhone,
          deliveryAddress: o.deliveryAddress,
          deliveryPostcode: o.deliveryPostcode,
          status: o.status,
          notes: o.notes,
          wasRecommended: o.wasRecommended,
          recommendationScore: o.recommendationScore,
          createdAt: o.createdAt,
          slot: {
            id: o.slot.id,
            date: o.slot.date,
            timeStart: o.slot.timeStart,
            timeEnd: o.slot.timeEnd,
            locationName: o.slot.location.name,
          },
        })),
        preferences,
        recommendationLogs,
      },
    };

    logger.info("gdpr.data_request_admin_export", {
      shop: session.shop,
      customerEmail,
      customerId,
      counts: result.counts,
    });

    return json<LoaderData>({
      shop: session.shop,
      searchedEmail: customerEmail,
      searchedCustomerId: customerId,
      result,
      error: null,
    });
  } catch (err) {
    logger.error("gdpr.data_request_admin_export failed", err, {
      shop: session.shop,
      customerEmail,
      customerId,
    });
    return json<LoaderData>({
      shop: session.shop,
      searchedEmail: customerEmail,
      searchedCustomerId: customerId,
      result: null,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export default function DataRequests() {
  const { shop, searchedEmail, searchedCustomerId, result, error } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("customerEmail") ?? "");
  const [custId, setCustId] = useState(searchParams.get("customerId") ?? "");
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  function downloadJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    // Sanitize each filename segment to alphanumerics, hyphens, and
    // underscores. Email's `@`, shop's `.`, and timestamp's `:`/`.`
    // can otherwise confuse OS-level download handlers (the `.` in
    // bannoscakes.myshopify.com creates a multi-extension filename
    // some download managers misinterpret).
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
    const customerSegment = searchedEmail ?? searchedCustomerId ?? "unknown";
    const filename = `gdpr-export-${safe(shop)}-${safe(customerSegment)}-${safe(result.exportedAt)}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Page title="GDPR data export">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Find a customer&apos;s data
              </Text>
              <Text as="p" tone="subdued">
                When Shopify sends you a customer&apos;s GDPR Subject Access
                Request (the {`"customers/data_request"`} webhook), enter the
                customer&apos;s email or Shopify customer ID below. We&apos;ll
                run a search across all the data Ordak Go has stored for
                them — order schedules, customer preferences, and
                recommendation logs — and produce a JSON file you can
                download and forward to the customer to fulfill the request.
              </Text>
              <Form method="get">
                <BlockStack gap="300">
                  <TextField
                    label="Customer email"
                    name="customerEmail"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    autoComplete="off"
                    helpText="Match against orderLinks.customerEmail and customerPreferences.customerEmail."
                  />
                  <TextField
                    label="Shopify customer ID"
                    name="customerId"
                    value={custId}
                    onChange={setCustId}
                    autoComplete="off"
                    helpText="Optional. Match against customerPreferences.customerId and recommendationLog.customerId. Leave blank to search by email only."
                  />
                  <InlineStack align="end">
                    <Button submit variant="primary" loading={isLoading} disabled={isLoading}>
                      Run search
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        {error ? (
          <Layout.Section>
            <Banner tone="critical">
              <Text as="p">Search failed: {error}</Text>
            </Banner>
          </Layout.Section>
        ) : null}

        {result ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Result
                </Text>
                <Text as="p">
                  Found {result.counts.orderLinks} order link(s),{" "}
                  {result.counts.preferences} preference record(s), and{" "}
                  {result.counts.recommendationLogs} recommendation log(s) for{" "}
                  {result.query.customerEmail
                    ? `email ${result.query.customerEmail}`
                    : `customer id ${result.query.customerId}`}
                  .
                </Text>
                {result.counts.orderLinks === 0 &&
                result.counts.preferences === 0 &&
                result.counts.recommendationLogs === 0 ? (
                  <Banner tone="info">
                    <Text as="p">
                      Ordak Go has no stored data for this customer. Reply to
                      the customer&apos;s GDPR request with a confirmation
                      that no data is held.
                    </Text>
                  </Banner>
                ) : (
                  <InlineStack align="end">
                    <Button onClick={downloadJson} variant="primary">
                      Download JSON
                    </Button>
                  </InlineStack>
                )}
                <pre
                  style={{
                    background: "var(--p-color-bg-surface-secondary)",
                    padding: 12,
                    overflow: "auto",
                    maxHeight: 400,
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(result, null, 2)}
                </pre>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}
      </Layout>
    </Page>
  );
}
