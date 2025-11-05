/**
 * Orders Create Webhook
 * Process orders and add scheduling metafields/tags when linked to a slot
 */

import type { ActionFunctionArgs } from "@remix-run/node";
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

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

    if (topic !== "ORDERS_CREATE") {
      return new Response("Invalid webhook topic", { status: 400 });
    }

    // Extract order ID from payload
    const orderId = payload.id?.toString();
    const gid = `gid://shopify/Order/${orderId}`;

    if (!orderId) {
      console.error("No order ID in webhook payload");
      return new Response("No order ID", { status: 400 });
    }

    // Check if this order has been linked to a slot
    const orderLink = await prisma.orderLink.findUnique({
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
      // Order not linked to a slot, nothing to do
      console.log(`Order ${orderId} not linked to scheduling`);
      return new Response("OK", { status: 200 });
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
      console.error(`Failed to add metafields to order ${orderId}`);
    }

    // Add tags to order
    const tagsSuccess = await addOrderTags(admin.graphql, gid, tags);

    if (!tagsSuccess) {
      console.error(`Failed to add tags to order ${orderId}`);
    }

    // Add note to order
    const noteSuccess = await addOrderNote(admin.graphql, gid, note);

    if (!noteSuccess) {
      console.error(`Failed to add note to order ${orderId}`);
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

    console.log(`Successfully processed order ${orderId} with scheduling data`);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response("Error", { status: 500 });
  }
}
