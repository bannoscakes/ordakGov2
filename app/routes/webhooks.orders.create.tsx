/**
 * Orders Create Webhook
 * Process orders and add scheduling metafields/tags when linked to a slot
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  addOrderMetafields,
  addOrderTags,
  generateOrderTags,
  type SchedulingMetafields,
} from "../services/metafield.service";
import { extractScheduling } from "../services/scheduling-extract.server";
import type { NameValuePair } from "../services/scheduling-extract.server";
import { logger } from "../utils/logger.server";

interface ShippingAddress {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
}

interface CustomerPayload {
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

interface OrderPayload {
  id?: number | string;
  order_number?: number | string;
  email?: string | null;
  phone?: string | null;
  contact_email?: string | null;
  customer?: CustomerPayload | null;
  note_attributes?: NameValuePair[];
  line_items?: Array<{ properties?: NameValuePair[] }>;
  shipping_address?: ShippingAddress | null;
  billing_address?: ShippingAddress | null;
}

function formatAddress(addr: ShippingAddress): string {
  // Customer-name-first format: "Jane Doe, 24 Paine Street, Apt 5,
  // Maroubra NSW 2035, Australia". Compresses suburb/state/postcode into
  // one comma-group so it reads like a postal label rather than a list.
  const name =
    addr.name ||
    [addr.first_name, addr.last_name].filter((s) => s && s.trim()).join(" ");
  const street = [addr.address1, addr.address2]
    .filter((s) => s && s.trim())
    .join(", ");
  const localityParts = [addr.city, addr.province, addr.zip]
    .filter((s) => s && s.trim())
    .join(" ");
  return [name, street, localityParts, addr.country]
    .filter((s) => s && s.trim())
    .join(", ");
}

// Pull customer email/phone preferring top-level (most reliable) and
// falling back to nested customer object. Different Shopify integrations
// (B2B, draft orders, abandoned recovery) populate different paths.
function extractContact(order: OrderPayload): { email: string | null; phone: string | null } {
  const email =
    order.email?.trim() ||
    order.contact_email?.trim() ||
    order.customer?.email?.trim() ||
    null;
  const phone =
    order.phone?.trim() ||
    order.customer?.phone?.trim() ||
    order.shipping_address?.phone?.trim() ||
    order.billing_address?.phone?.trim() ||
    null;
  return { email: email || null, phone: phone || null };
}

export async function action({ request }: ActionFunctionArgs) {
  // Hoist context so the outer catch can include orderId/shop in the log.
  let logCtx: { orderId?: string; shop?: string; topic?: string } = {};
  try {
    const { topic, shop, admin, payload } = await authenticate.webhook(request);
    logCtx = { topic, shop };

    if (topic !== "ORDERS_CREATE") {
      return new Response("Invalid webhook topic", { status: 400 });
    }

    if (!admin) {
      // No admin context — webhook is unauthenticated or shop has uninstalled.
      return new Response("No admin context", { status: 401 });
    }

    const order = payload as OrderPayload;
    const orderId = order.id?.toString();
    const gid = `gid://shopify/Order/${orderId}`;
    logCtx = { ...logCtx, orderId };

    if (!orderId) {
      logger.error("No order ID in webhook payload", undefined, { topic, shop });
      return new Response("No order ID", { status: 400 });
    }

    let orderLink = await prisma.orderLink.findUnique({
      where: { shopifyOrderId: orderId },
      include: {
        slot: {
          include: {
            location: { include: { shop: true } },
          },
        },
      },
    });

    // Cross-shop guard for the existing-link path: the same defense-in-depth
    // check the create branch does. A stale `_slot_id` from another shop's
    // upstream code could produce an OrderLink whose slot belongs to a
    // different shop. We refuse to write tags/metafields against the wrong
    // shop's order id.
    if (orderLink && orderLink.slot.location.shop.shopifyDomain !== shop) {
      await prisma.eventLog.create({
        data: {
          orderLinkId: orderLink.id,
          eventType: "order.cross_shop_rejected",
          payload: JSON.stringify({
            orderId,
            slotShop: orderLink.slot.location.shop.shopifyDomain,
            webhookShop: shop,
          }),
        },
      });
      logger.error("Existing OrderLink belongs to a different shop", undefined, {
        orderId,
        slotShop: orderLink.slot.location.shop.shopifyDomain,
        shop,
      });
      // 200 — Shopify retrying won't help; this is a data issue.
      return new Response("OK", { status: 200 });
    }

    if (!orderLink) {
      const scheduling = extractScheduling(order);
      if (!scheduling) {
        logger.info("Order not linked to scheduling", { orderId, shop });
        return new Response("OK", { status: 200 });
      }

      const slot = await prisma.slot.findUnique({
        where: { id: scheduling.slotId },
        include: { location: { include: { shop: true } } },
      });

      if (!slot) {
        // Audit trail: the customer paid, the cart said `_slot_id=X`, but
        // X is gone (admin deleted slot mid-checkout, or stale cart). The
        // order has no scheduling but is otherwise valid; surface it via
        // EventLog so the admin can chase it manually.
        await prisma.eventLog.create({
          data: {
            orderLinkId: null,
            eventType: "order.scheduling_orphaned",
            payload: JSON.stringify({
              orderId,
              slotId: scheduling.slotId,
              shop,
              reason: "slot_not_found",
            }),
          },
        });
        logger.warn("Slot not found for order", { orderId, slotId: scheduling.slotId, shop });
        return new Response("OK", { status: 200 });
      }

      if (slot.location.shop.shopifyDomain !== shop) {
        await prisma.eventLog.create({
          data: {
            orderLinkId: null,
            eventType: "order.cross_shop_rejected",
            payload: JSON.stringify({
              orderId,
              slotId: scheduling.slotId,
              slotShop: slot.location.shop.shopifyDomain,
              webhookShop: shop,
              reason: "create_path",
            }),
          },
        });
        logger.error("Slot does not belong to webhook shop", undefined, {
          orderId,
          slotId: scheduling.slotId,
          slotShop: slot.location.shop.shopifyDomain,
          shop,
        });
        return new Response("OK", { status: 200 });
      }

      const contact = extractContact(order);
      // For pickup orders the customer doesn't fill a shipping address —
      // checkout uses billing address as the source. Fall back so the
      // OrderLink always has at least one address record.
      const addr = order.shipping_address ?? order.billing_address ?? null;

      try {
        const created = await prisma.$transaction(async (tx) => {
          const link = await tx.orderLink.create({
            data: {
              shopifyOrderId: orderId,
              shopifyOrderNumber: order.order_number?.toString() ?? null,
              slotId: slot.id,
              fulfillmentType: scheduling.fulfillmentType,
              customerEmail: contact.email,
              customerPhone: contact.phone,
              deliveryAddress: addr ? formatAddress(addr) : null,
              deliveryPostcode: addr?.zip ?? null,
              wasRecommended: scheduling.wasRecommended,
              recommendationScore: scheduling.recommendationScore,
              status: "scheduled",
            },
          });
          await tx.slot.update({
            where: { id: slot.id },
            data: { booked: { increment: 1 } },
          });
          await tx.eventLog.create({
            data: {
              orderLinkId: link.id,
              eventType: "order.linked",
              payload: JSON.stringify({
                orderId,
                slotId: slot.id,
                fulfillmentType: scheduling.fulfillmentType,
                wasRecommended: scheduling.wasRecommended,
              }),
            },
          });
          return link;
        });

        orderLink = await prisma.orderLink.findUnique({
          where: { id: created.id },
          include: { slot: { include: { location: { include: { shop: true } } } } },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          // Only treat the OrderLink unique-constraint as a dedupe signal;
          // any OTHER P2002 (e.g. a future composite unique) shouldn't be
          // silently swallowed.
          (err.meta?.target as string[] | undefined)?.includes("shopifyOrderId")
        ) {
          orderLink = await prisma.orderLink.findUnique({
            where: { shopifyOrderId: orderId },
            include: { slot: { include: { location: { include: { shop: true } } } } },
          });
          logger.info("OrderLink already existed (webhook redelivery)", { orderId, shop });
        } else {
          throw err;
        }
      }

      if (!orderLink) {
        // The P2002 retry path's findUnique returned null. Should be
        // unreachable in practice (we just got P2002 because the row
        // exists), but lock it down with a loud error rather than a silent
        // 200 so a future schema regression surfaces.
        logger.error("OrderLink lookup raced and lost after P2002 retry", undefined, {
          orderId,
          shop,
        });
        return new Response("Inconsistent OrderLink state", { status: 500 });
      }
    }

    const metafields: SchedulingMetafields = {
      slotId: orderLink.slot.id,
      slotDate: orderLink.slot.date.toISOString().split("T")[0],
      slotTimeStart: orderLink.slot.timeStart,
      slotTimeEnd: orderLink.slot.timeEnd,
      // Source of truth is the slot row, not the (possibly stale) cart
      // attribute that created the OrderLink.
      fulfillmentType: orderLink.slot.fulfillmentType as "delivery" | "pickup",
      locationId: orderLink.slot.location.id,
      locationName: orderLink.slot.location.name,
      wasRecommended: orderLink.wasRecommended,
    };

    // Tags only — we never touch the order Note (customer + merchant
    // notes live there). All scheduling data lives in the
    // ordak_scheduling metafields panel.
    const tags = generateOrderTags(metafields);

    const metafieldsResult = await addOrderMetafields(admin.graphql, gid, metafields);
    const tagsResult = await addOrderTags(admin.graphql, gid, tags);

    await prisma.eventLog.create({
      data: {
        orderLinkId: orderLink.id,
        eventType: "order.shopify_writes_attempted",
        payload: JSON.stringify({
          orderId,
          metafields: metafieldsResult,
          tags: tagsResult,
          tagList: tags,
        }),
      },
    });

    // Critical: if either Shopify-side write failed, return 5xx so Shopify
    // retries the webhook. The OrderLink + slot.booked have already
    // committed in the transaction above, so the retry hits the existing-
    // OrderLink path and re-attempts only the metafield/tag writes —
    // safely idempotent (orderUpdate metafields are upserts; tagsAdd is
    // a set-merge). Without this, a transient throttle leaves the order
    // un-tagged in Shopify while our DB says scheduled — the manufacturing
    // system never sees the order.
    if (!metafieldsResult.ok || !tagsResult.ok) {
      logger.error("Shopify-side writes failed; will rely on Shopify retry", undefined, {
        orderId,
        shop,
        metafields: metafieldsResult,
        tags: tagsResult,
      });
      return new Response("Shopify writes incomplete", { status: 503 });
    }

    logger.info("Successfully processed order with scheduling data", { orderId });
    return new Response("OK", { status: 200 });
  } catch (error) {
    logger.error("Webhook processing error", error, logCtx);
    return new Response("Error", { status: 500 });
  }
}
