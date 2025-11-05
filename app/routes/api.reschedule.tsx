import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * API endpoint for customers to reschedule their orders
 * This can be called from the storefront widget
 */
export async function action({ request }: ActionFunctionArgs) {
  // For storefront requests, use appProxy authentication
  // For now, we'll use a simple approach that could be called from the admin or a custom app
  try {
    const formData = await request.formData();
    const shopDomain = formData.get("shop") as string;
    const orderId = formData.get("orderId") as string;
    const newSlotId = formData.get("newSlotId") as string;
    const reason = formData.get("reason") as string;

    if (!shopDomain || !orderId || !newSlotId) {
      return json(
        {
          success: false,
          error: "Missing required parameters: shop, orderId, newSlotId",
        },
        { status: 400 }
      );
    }

    // Find the shop
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
    });

    if (!shop) {
      return json({ success: false, error: "Shop not found" }, { status: 404 });
    }

    // Find the current booking
    const orderLink = await prisma.orderLink.findFirst({
      where: {
        shopId: shop.id,
        shopifyOrderId: orderId,
        status: {
          in: ["scheduled", "updated"],
        },
      },
      include: {
        slot: true,
      },
    });

    if (!orderLink) {
      return json(
        {
          success: false,
          error: "Order booking not found or already completed/canceled",
        },
        { status: 404 }
      );
    }

    // Verify the new slot exists and has capacity
    const newSlot = await prisma.slot.findUnique({
      where: { id: newSlotId },
      include: { location: true },
    });

    if (!newSlot) {
      return json({ success: false, error: "New slot not found" }, { status: 404 });
    }

    if (newSlot.booked >= newSlot.capacity) {
      return json(
        { success: false, error: "Selected slot is fully booked" },
        { status: 400 }
      );
    }

    const oldSlotId = orderLink.slotId;

    // Perform the reschedule in a transaction
    await prisma.$transaction(async (tx) => {
      // Decrement old slot's booked count
      await tx.slot.update({
        where: { id: oldSlotId },
        data: {
          booked: {
            decrement: 1,
          },
        },
      });

      // Increment new slot's booked count
      await tx.slot.update({
        where: { id: newSlotId },
        data: {
          booked: {
            increment: 1,
          },
        },
      });

      // Update the order link
      await tx.orderLink.update({
        where: { id: orderLink.id },
        data: {
          slotId: newSlotId,
          status: "updated",
        },
      });

      // Create event log entry
      await tx.eventLog.create({
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
    console.error("Reschedule API error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
      },
      { status: 500 }
    );
  }
}

export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
