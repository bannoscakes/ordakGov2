import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { writeEventLogTx, dispatchEventLog, type DispatchableEventLog } from "../services/event-log.server";

/**
 * POST /api/reschedule
 *
 * Storefront-customer reschedule endpoint. Reachable via
 *   POST /apps/ordak-go/reschedule  (Shopify App Proxy → apps.proxy.reschedule)
 *
 * Direct hits to /api/reschedule fail proxy signature validation and
 * return 401. The proxy wrapper at apps.proxy.reschedule.tsx pins the
 * shop to session.shop before delegating, and this action also
 * authenticates so the bare URL can't be hit out-of-band.
 *
 * Shop identity is derived from session.shop only — never from the
 * request body. The new slot lookup is shop-scoped so a customer of
 * shop A cannot rebook their order onto shop B's slot (the F1 cross-
 * tenant write that motivated this rewrite).
 */
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      newSlotId?: string;
      reason?: string;
    };
    const { orderId, newSlotId, reason } = body;

    if (!orderId || !newSlotId) {
      return json(
        { success: false, error: "Missing required parameters: orderId, newSlotId" },
        { status: 400 },
      );
    }

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      return json({ success: false, error: "Shop not found" }, { status: 404 });
    }

    // Find the current booking — already shop-scoped via slot.location.shopId.
    const orderLink = await prisma.orderLink.findFirst({
      where: {
        shopifyOrderId: orderId,
        slot: { location: { shopId: shop.id } },
        status: { in: ["scheduled", "updated"] },
      },
      include: { slot: true },
    });

    if (!orderLink) {
      return json(
        {
          success: false,
          error: "Order booking not found or already completed/canceled",
        },
        { status: 404 },
      );
    }

    // Verify the new slot exists, belongs to this shop, and has capacity.
    // findFirst with the shop-scoped where closes the F1 cross-tenant
    // booking — without the location.shopId filter, a global slot id
    // resolves regardless of which shop owns it.
    const newSlot = await prisma.slot.findFirst({
      where: { id: newSlotId, location: { shopId: shop.id } },
      include: { location: true },
    });

    if (!newSlot) {
      return json(
        { success: false, error: "New slot not found" },
        { status: 404 },
      );
    }

    if (newSlot.booked >= newSlot.capacity) {
      return json(
        { success: false, error: "Selected slot is fully booked" },
        { status: 400 },
      );
    }

    const oldSlotId = orderLink.slotId;
    let pendingEvent: DispatchableEventLog | null = null;
    let capacityRace = false;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.slot.update({
          where: { id: oldSlotId },
          data: { booked: { decrement: 1 } },
        });

        // Atomic capacity-check + increment. The pre-tx read can race
        // against another commit; do the comparison in SQL so the
        // increment only lands if there's still room. Throwing rolls
        // back the decrement above.
        const incrementResult = await tx.$executeRaw`
          UPDATE "Slot"
          SET booked = booked + 1
          WHERE id = ${newSlotId} AND booked < capacity
        `;
        if (incrementResult === 0) {
          capacityRace = true;
          throw new Error("CAPACITY_RACE");
        }

        await tx.orderLink.update({
          where: { id: orderLink.id },
          data: { slotId: newSlotId, status: "updated" },
        });

        pendingEvent = await writeEventLogTx({
          tx,
          data: {
            orderLinkId: orderLink.id,
            eventType: "order.schedule_updated",
            timestamp: new Date(),
            payload: JSON.stringify({
              orderId,
              oldSlotId,
              newSlotId,
              oldSlot: {
                date: orderLink.slot.date,
                timeStart: orderLink.slot.timeStart,
                timeEnd: orderLink.slot.timeEnd,
              },
              newSlot: {
                date: newSlot.date,
                timeStart: newSlot.timeStart,
                timeEnd: newSlot.timeEnd,
                locationName: newSlot.location.name,
                locationAddress: newSlot.location.address,
              },
              reason: reason || "Customer requested reschedule",
              rescheduledBy: "customer",
              rescheduledAt: new Date().toISOString(),
            }),
          },
        });
      });
    } catch (txErr) {
      if (capacityRace) {
        return json(
          { success: false, error: "Selected slot just filled — pick another" },
          { status: 409 },
        );
      }
      throw txErr;
    }

    if (pendingEvent) {
      await dispatchEventLog(shop.id, pendingEvent);
    }

    return json({
      success: true,
      message: "Order successfully rescheduled",
      data: {
        orderId,
        newSlot: {
          id: newSlot.id,
          date: newSlot.date,
          timeStart: newSlot.timeStart,
          timeEnd: newSlot.timeEnd,
          location: {
            name: newSlot.location.name,
            address: newSlot.location.address,
          },
        },
      },
    });
  } catch (error) {
    logger.error("Reschedule API error", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
      },
      { status: 500 },
    );
  }
}

export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
