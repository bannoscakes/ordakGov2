// One-shot backfill: re-runs the orders/create handler against orders
// that were placed BEFORE the ORDERS_CREATE webhook subscription was
// added. Fetches the most recent N orders that don't already have an
// OrderLink and synthesizes the same call the webhook would have made.

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  addOrderMetafields,
  addOrderTags,
  generateOrderTags,
  type SchedulingMetafields,
} from "../services/metafield.service";
import {
  extractScheduling,
  type ExtractedScheduling,
} from "../services/scheduling-extract.server";

interface OrderResult {
  orderId: string;
  orderName: string;
  status: "linked" | "skipped" | "error";
  detail: string;
}

interface Status {
  ok: boolean;
  message: string;
  results: OrderResult[];
}

// Adapt the Admin GraphQL response (camelCase customAttributes) into the
// REST-shaped contract scheduling-extract reads. The webhook handler
// reads its REST payload directly; this is the only path that needs
// a shape adapter.
function extractFromAdminOrder(order: {
  customAttributes?: Array<{ key: string; value: string }>;
  lineItems?: { nodes: Array<{ customAttributes?: Array<{ key: string; value: string }> }> };
}): ExtractedScheduling | null {
  return extractScheduling({
    note_attributes: (order.customAttributes ?? []).map((a) => ({
      name: a.key,
      value: a.value,
    })),
    line_items: (order.lineItems?.nodes ?? []).map((n) => ({
      properties: (n.customAttributes ?? []).map((a) => ({
        name: a.key,
        value: a.value,
      })),
    })),
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const results: OrderResult[] = [];

  try {
    const ordersRes = await admin.graphql(
      `#graphql
        query OrdakGoRecentOrders {
          orders(first: 10, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              email
              phone
              customAttributes { key value }
              shippingAddress { address1 address2 city province zip country }
              lineItems(first: 25) {
                nodes { customAttributes { key value } }
              }
            }
          }
        }`,
    );
    const ordersBody = await ordersRes.json();
    const orders = ordersBody.data?.orders?.nodes ?? [];

    const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
    if (!shop) return json<Status>({ ok: false, message: "No Shop row", results });

    for (const order of orders) {
      const orderIdNum = order.id.split("/").pop()!;
      const existing = await prisma.orderLink.findUnique({
        where: { shopifyOrderId: orderIdNum },
      });
      if (existing) {
        results.push({
          orderId: orderIdNum,
          orderName: order.name,
          status: "skipped",
          detail: "OrderLink already exists",
        });
        continue;
      }

      const scheduling = extractFromAdminOrder(order);
      if (!scheduling) {
        results.push({
          orderId: orderIdNum,
          orderName: order.name,
          status: "skipped",
          detail: "No scheduling data on order",
        });
        continue;
      }

      const slot = await prisma.slot.findUnique({
        where: { id: scheduling.slotId },
        include: { location: { include: { shop: true } } },
      });
      if (!slot || slot.location.shop.shopifyDomain !== session.shop) {
        results.push({
          orderId: orderIdNum,
          orderName: order.name,
          status: "error",
          detail: `Slot ${scheduling.slotId} not found / cross-shop`,
        });
        continue;
      }

      try {
        const created = await prisma.$transaction(async (tx) => {
          const link = await tx.orderLink.create({
            data: {
              shopifyOrderId: orderIdNum,
              shopifyOrderNumber: order.name?.replace(/^#/, "") ?? null,
              slotId: slot.id,
              fulfillmentType: scheduling.fulfillmentType,
              customerEmail: order.email ?? null,
              customerPhone: order.phone ?? null,
              deliveryAddress: order.shippingAddress
                ? [
                    order.shippingAddress.address1,
                    order.shippingAddress.address2,
                    order.shippingAddress.city,
                    order.shippingAddress.province,
                    order.shippingAddress.zip,
                    order.shippingAddress.country,
                  ]
                    .filter((s) => s && String(s).trim())
                    .join(", ")
                : null,
              deliveryPostcode: order.shippingAddress?.zip ?? null,
              wasRecommended: scheduling.wasRecommended,
              recommendationScore: scheduling.recommendationScore,
              status: "scheduled",
            },
          });
          await tx.slot.update({
            where: { id: slot.id },
            data: { booked: { increment: 1 } },
          });
          return link;
        });

        const metafields: SchedulingMetafields = {
          slotId: slot.id,
          slotDate: slot.date.toISOString().split("T")[0],
          slotTimeStart: slot.timeStart,
          slotTimeEnd: slot.timeEnd,
          fulfillmentType: scheduling.fulfillmentType,
          locationId: slot.location.id,
          locationName: slot.location.name,
          wasRecommended: scheduling.wasRecommended,
        };
        const tags = generateOrderTags(metafields);
        const metafieldRes = await addOrderMetafields(admin.graphql, order.id, metafields);
        const tagsRes = await addOrderTags(admin.graphql, order.id, tags);

        const writeFailures: string[] = [];
        if (!metafieldRes.ok) writeFailures.push(`metafields: ${metafieldRes.reason} — ${metafieldRes.detail}`);
        if (!tagsRes.ok) writeFailures.push(`tags: ${tagsRes.reason} — ${tagsRes.detail}`);

        await prisma.eventLog.create({
          data: {
            orderLinkId: created.id,
            eventType: writeFailures.length ? "order.shopify_writes_partial" : "order.metafields_added",
            payload: JSON.stringify({
              orderId: orderIdNum,
              backfilled: true,
              tags,
              ...(writeFailures.length ? { failures: writeFailures } : {}),
            }),
          },
        });

        results.push({
          orderId: orderIdNum,
          orderName: order.name,
          status: writeFailures.length ? "error" : "linked",
          detail: writeFailures.length
            ? `OrderLink created but Shopify writes failed: ${writeFailures.join("; ")}`
            : `${scheduling.fulfillmentType} • slot ${slot.timeStart}-${slot.timeEnd} • tags: ${tags.join(", ")}`,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          results.push({
            orderId: orderIdNum,
            orderName: order.name,
            status: "skipped",
            detail: "OrderLink raced with concurrent insert",
          });
        } else {
          results.push({
            orderId: orderIdNum,
            orderName: order.name,
            status: "error",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return json<Status>({
      ok: true,
      message: `Processed ${orders.length} order(s).`,
      results,
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
    return json<Status>({ ok: false, message: `Backfill error: ${message}`, results });
  }
}

export default function BackfillOrders() {
  const status = useLoaderData<typeof loader>();
  return (
    <Page title="Backfill orders into Ordak Go">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Banner tone={status.ok ? "success" : "critical"}>
                <Text as="p">{status.message}</Text>
              </Banner>
              {status.results.length ? (
                <BlockStack gap="200">
                  {status.results.map((r) => (
                    <BlockStack key={r.orderId} gap="050">
                      <Text as="p" fontWeight="semibold">
                        {r.orderName} — {r.status}
                      </Text>
                      <Text as="p" tone="subdued">
                        {r.detail}
                      </Text>
                    </BlockStack>
                  ))}
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
