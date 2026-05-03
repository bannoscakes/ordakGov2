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
  addOrderNote,
  generateOrderNote,
  generateOrderTags,
  type SchedulingMetafields,
} from "../services/metafield.service";
import { logger } from "../utils/logger.server";

interface NameValuePair {
  name: string;
  value: string;
}

interface ShippingAddress {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
}

interface OrderPayload {
  id?: number | string;
  order_number?: number | string;
  email?: string | null;
  phone?: string | null;
  note_attributes?: NameValuePair[];
  line_items?: Array<{ properties?: NameValuePair[] }>;
  shipping_address?: ShippingAddress | null;
}

interface ExtractedScheduling {
  slotId: string;
  fulfillmentType: "delivery" | "pickup";
  wasRecommended: boolean;
  recommendationScore: number | null;
}

function valueFor(pairs: NameValuePair[] | undefined, key: string): string | undefined {
  return pairs?.find((p) => p.name === key)?.value;
}

function parseFulfillment(value: string | undefined): "delivery" | "pickup" {
  return value === "pickup" ? "pickup" : "delivery";
}

// Read scheduling info from the order. Line item properties win because they
// match what the Carrier Service callback saw at checkout — note_attributes
// (cart attributes) are the fallback for orders that bypassed shipping (e.g.
// pickup) where carrier service didn't run.
function extractScheduling(payload: OrderPayload): ExtractedScheduling | null {
  for (const line of payload.line_items ?? []) {
    const slotId = valueFor(line.properties, "_slot_id");
    if (slotId) {
      const score = valueFor(line.properties, "_recommendation_score");
      return {
        slotId,
        fulfillmentType: parseFulfillment(valueFor(line.properties, "_delivery_method")),
        wasRecommended: valueFor(line.properties, "_was_recommended") === "true",
        recommendationScore: score ? Number(score) : null,
      };
    }
  }

  const slotId = valueFor(payload.note_attributes, "slot_id");
  if (!slotId) return null;
  const score = valueFor(payload.note_attributes, "recommendation_score");
  return {
    slotId,
    fulfillmentType: parseFulfillment(valueFor(payload.note_attributes, "delivery_method")),
    wasRecommended: valueFor(payload.note_attributes, "was_recommended") === "true",
    recommendationScore: score ? Number(score) : null,
  };
}

function formatAddress(addr: ShippingAddress): string {
  return [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter((s) => s && s.trim())
    .join(", ");
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { topic, shop, admin, payload } = await authenticate.webhook(request);

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

    if (!orderId) {
      logger.error("No order ID in webhook payload", undefined, { topic, shop });
      return new Response("No order ID", { status: 400 });
    }

    let orderLink = await prisma.orderLink.findUnique({
      where: { shopifyOrderId: orderId },
      include: {
        slot: {
          include: {
            location: true,
          },
        },
      },
    });

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
        logger.warn("Slot not found for order", {
          orderId,
          slotId: scheduling.slotId,
          shop,
        });
        return new Response("OK", { status: 200 });
      }

      // Cross-shop guard: the slot must belong to the webhook's shop.
      if (slot.location.shop.shopifyDomain !== shop) {
        logger.error("Slot does not belong to webhook shop", undefined, {
          orderId,
          slotId: scheduling.slotId,
          slotShop: slot.location.shop.shopifyDomain,
          shop,
        });
        return new Response("OK", { status: 200 });
      }

      try {
        const created = await prisma.$transaction(async (tx) => {
          const link = await tx.orderLink.create({
            data: {
              shopifyOrderId: orderId,
              shopifyOrderNumber: order.order_number?.toString() ?? null,
              slotId: slot.id,
              fulfillmentType: scheduling.fulfillmentType,
              customerEmail: order.email ?? null,
              customerPhone: order.phone ?? null,
              deliveryAddress: order.shipping_address
                ? formatAddress(order.shipping_address)
                : null,
              deliveryPostcode: order.shipping_address?.zip ?? null,
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

        orderLink = await prisma.orderLink.findUnique({
          where: { id: created.id },
          include: { slot: { include: { location: true } } },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          // Idempotent retry — webhook re-delivery after we already linked.
          orderLink = await prisma.orderLink.findUnique({
            where: { shopifyOrderId: orderId },
            include: { slot: { include: { location: true } } },
          });
          logger.info("OrderLink already existed (webhook redelivery)", { orderId, shop });
        } else {
          throw err;
        }
      }

      if (!orderLink) {
        // Lookup raced with creation by another concurrent webhook delivery.
        return new Response("OK", { status: 200 });
      }
    }

    // Prepare metafields
    const metafields: SchedulingMetafields = {
      slotId: orderLink.slot.id,
      slotDate: orderLink.slot.date.toISOString().split('T')[0],
      slotTimeStart: orderLink.slot.timeStart,
      slotTimeEnd: orderLink.slot.timeEnd,
      fulfillmentType: orderLink.fulfillmentType as 'delivery' | 'pickup',
      locationId: orderLink.slot.location.id,
      locationName: orderLink.slot.location.name,
      wasRecommended: orderLink.wasRecommended,
    };

    // Generate tags and note
    const tags = generateOrderTags(metafields);
    const note = generateOrderNote(metafields);

    // Add metafields to order
    const metafieldsSuccess = await addOrderMetafields(
      admin.graphql,
      gid,
      metafields
    );

    if (!metafieldsSuccess) {
      logger.warn("Failed to add metafields to order", { orderId, shop });
    }

    // Add tags to order
    const tagsSuccess = await addOrderTags(admin.graphql, gid, tags);

    if (!tagsSuccess) {
      logger.warn("Failed to add tags to order", { orderId, shop });
    }

    // Add note to order
    const noteSuccess = await addOrderNote(admin.graphql, gid, note);

    if (!noteSuccess) {
      logger.warn("Failed to add note to order", { orderId, shop });
    }

    // Log the completion
    await prisma.eventLog.create({
      data: {
        orderLinkId: orderLink.id,
        eventType: "order.metafields_added",
        payload: JSON.stringify({
          orderId,
          metafieldsAdded: metafieldsSuccess,
          tagsAdded: tagsSuccess,
          noteAdded: noteSuccess,
          tags,
        }),
      },
    });

    logger.info("Successfully processed order with scheduling data", { orderId });
    return new Response("OK", { status: 200 });
  } catch (error) {
    logger.error("Webhook processing error", error);
    return new Response("Error", { status: 500 });
  }
}
