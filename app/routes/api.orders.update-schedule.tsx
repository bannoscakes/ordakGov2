/**
 * Update Order Schedule API
 * Update scheduling information for an existing order
 *
 * POST /api/orders/update-schedule
 * Body: {
 *   orderId: string,
 *   slotId: string
 * }
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  writeEventLogTx,
  dispatchEventLog,
  type DispatchableEventLog,
} from "../services/event-log.server";
import {
  addOrderMetafields,
  addOrderTags,
  addOrderNote,
  generateOrderNote,
  generateOrderTags,
  type SchedulingMetafields,
} from "../services/metafield.service";

interface UpdateScheduleRequest {
  orderId: string;
  slotId: string;
}

interface UpdateScheduleResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { admin, session } = await authenticate.admin(request);

    const body = await request.json();
    const { orderId, slotId } = body as UpdateScheduleRequest;

    // Validation
    if (!orderId || !slotId) {
      return json<UpdateScheduleResponse>(
        { success: false, error: "Order ID and Slot ID are required" },
        { status: 400 }
      );
    }

    // Find the new slot
    const newSlot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: {
        location: true,
      },
    });

    if (!newSlot) {
      return json<UpdateScheduleResponse>(
        { success: false, error: "Slot not found" },
        { status: 404 }
      );
    }

    // Check if slot has capacity
    if (newSlot.booked >= newSlot.capacity) {
      return json<UpdateScheduleResponse>(
        { success: false, error: "Slot is full" },
        { status: 400 }
      );
    }

    // Find existing order link
    const existingLink = await prisma.orderLink.findUnique({
      where: { shopifyOrderId: orderId },
      include: {
        slot: true,
      },
    });

    if (!existingLink) {
      return json<UpdateScheduleResponse>(
        { success: false, error: "Order not linked to any slot" },
        { status: 404 }
      );
    }

    // Wrap link update + slot dec/inc + event log in one transaction so a
    // partial failure can't leave the row pointing at the new slot while
    // booked counts still reflect the old. The atomic capacity check inside
    // the tx (using $executeRaw) prevents double-booking under concurrent
    // commits — the pre-tx booked >= capacity check above is a fast-path
    // UX hint, not the authority.
    let pendingEvent: DispatchableEventLog | null = null;
    let capacityRace = false;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.orderLink.update({
          where: { id: existingLink.id },
          data: {
            slotId: newSlot.id,
            fulfillmentType: newSlot.fulfillmentType,
            status: "updated",
          },
        });

        await tx.slot.update({
          where: { id: existingLink.slotId },
          data: { booked: { decrement: 1 } },
        });

        const incrementResult = await tx.$executeRaw`
          UPDATE "Slot"
          SET booked = booked + 1
          WHERE id = ${newSlot.id} AND booked < capacity
        `;
        if (incrementResult === 0) {
          capacityRace = true;
          throw new Error("CAPACITY_RACE");
        }

        pendingEvent = await writeEventLogTx({
          tx,
          data: {
            orderLinkId: existingLink.id,
            eventType: "order.schedule_updated",
            timestamp: new Date(),
            payload: JSON.stringify({
              orderId,
              oldSlotId: existingLink.slotId,
              newSlotId: newSlot.id,
              oldSlotDate: existingLink.slot.date.toISOString(),
              oldSlotTime: `${existingLink.slot.timeStart} - ${existingLink.slot.timeEnd}`,
              newSlotDate: newSlot.date.toISOString(),
              newSlotTime: `${newSlot.timeStart} - ${newSlot.timeEnd}`,
            }),
          },
        });
      });
    } catch (txErr) {
      if (capacityRace) {
        return json<UpdateScheduleResponse>(
          { success: false, error: "Slot just filled — pick another" },
          { status: 409 }
        );
      }
      throw txErr;
    }

    if (pendingEvent) {
      await dispatchEventLog(newSlot.location.shopId, pendingEvent);
    }

    // Update Shopify order metafields and tags
    const gid = `gid://shopify/Order/${orderId}`;

    const metafields: SchedulingMetafields = {
      slotId: newSlot.id,
      slotDate: newSlot.date.toISOString().split('T')[0],
      slotTimeStart: newSlot.timeStart,
      slotTimeEnd: newSlot.timeEnd,
      fulfillmentType: newSlot.fulfillmentType as 'delivery' | 'pickup',
      locationId: newSlot.location.id,
      locationName: newSlot.location.name,
      wasRecommended: existingLink.wasRecommended,
    };

    // Update metafields
    await addOrderMetafields(admin.graphql, gid, metafields);

    // Update tags (add new date tag)
    const newTags = generateOrderTags(metafields);
    await addOrderTags(admin.graphql, gid, newTags);

    // Add update note
    const updateNote = `
${generateOrderNote(metafields)}

--- Previous Scheduling ---
Date: ${new Date(existingLink.slot.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}
Time: ${existingLink.slot.timeStart} - ${existingLink.slot.timeEnd}
    `.trim();

    await addOrderNote(admin.graphql, gid, updateNote);

    return json<UpdateScheduleResponse>({
      success: true,
      message: "Schedule updated successfully",
    });
  } catch (error) {
    logger.error("Schedule update error", error);
    return json<UpdateScheduleResponse>(
      {
        success: false,
        error: "Failed to update schedule",
      },
      { status: 500 }
    );
  }
}
