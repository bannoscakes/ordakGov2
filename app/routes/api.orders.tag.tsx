/**
 * Order Tagging API
 * Tag orders with scheduling information and add metafields
 *
 * POST /api/orders/tag
 * Body: {
 *   orderId: string,
 *   orderNumber: string,
 *   slotId: string,
 *   customerId?: string,
 *   customerEmail?: string
 * }
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

interface OrderTagRequest {
  orderId: string;
  orderNumber?: string;
  slotId: string;
  customerId?: string;
  customerEmail?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryPostcode?: string;
  wasRecommended?: boolean;
  recommendationScore?: number;
}

interface OrderTagResponse {
  success: boolean;
  orderLink?: {
    id: string;
    shopifyOrderId: string;
    slotId: string;
  };
  error?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Authenticate the request (app proxy or admin)
    const { session } = await authenticate.public.appProxy(request);

    const body = await request.json();
    const {
      orderId,
      orderNumber,
      slotId,
      customerId,
      customerEmail,
      customerPhone,
      deliveryAddress,
      deliveryPostcode,
      wasRecommended,
      recommendationScore,
    } = body as OrderTagRequest;

    // Validation
    if (!orderId || !slotId) {
      return json<OrderTagResponse>(
        { success: false, error: "Order ID and Slot ID are required" },
        { status: 400 }
      );
    }

    // Find the slot
    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            province: true,
            country: true,
            postalCode: true,
          },
        },
      },
    });

    if (!slot) {
      return json<OrderTagResponse>(
        { success: false, error: "Slot not found" },
        { status: 404 }
      );
    }

    // Check if order already linked
    const existingLink = await prisma.orderLink.findUnique({
      where: { shopifyOrderId: orderId },
    });

    if (existingLink) {
      return json<OrderTagResponse>(
        {
          success: false,
          error: "Order already linked to a slot",
        },
        { status: 400 }
      );
    }

    // Create order link
    const orderLink = await prisma.orderLink.create({
      data: {
        shopifyOrderId: orderId,
        shopifyOrderNumber: orderNumber || null,
        slotId,
        fulfillmentType: slot.fulfillmentType,
        customerEmail: customerEmail || null,
        customerPhone: customerPhone || null,
        deliveryAddress: deliveryAddress || null,
        deliveryPostcode: deliveryPostcode || null,
        wasRecommended: wasRecommended || false,
        recommendationScore: recommendationScore || null,
        status: "scheduled",
      },
    });

    // Update slot booked count
    await prisma.slot.update({
      where: { id: slotId },
      data: {
        booked: {
          increment: 1,
        },
      },
    });

    // Log the event
    await prisma.eventLog.create({
      data: {
        orderLinkId: orderLink.id,
        eventType: "order.scheduled",
        payload: JSON.stringify({
          orderId,
          orderNumber,
          slotId,
          fulfillmentType: slot.fulfillmentType,
          slotDate: slot.date.toISOString(),
          slotTime: `${slot.timeStart} - ${slot.timeEnd}`,
          locationName: slot.location.name,
          wasRecommended,
        }),
      },
    });

    // Return success with order link data
    return json<OrderTagResponse>({
      success: true,
      orderLink: {
        id: orderLink.id,
        shopifyOrderId: orderLink.shopifyOrderId,
        slotId: orderLink.slotId,
      },
    });
  } catch (error) {
    console.error("Order tagging error:", error);
    return json<OrderTagResponse>(
      {
        success: false,
        error: "Failed to tag order",
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve order scheduling info
export async function loader({ request }: ActionFunctionArgs) {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");

    if (!orderId) {
      return json(
        { error: "Order ID is required" },
        { status: 400 }
      );
    }

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
      return json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    return json({
      orderId: orderLink.shopifyOrderId,
      orderNumber: orderLink.shopifyOrderNumber,
      fulfillmentType: orderLink.fulfillmentType,
      status: orderLink.status,
      slot: {
        id: orderLink.slot.id,
        date: orderLink.slot.date,
        timeStart: orderLink.slot.timeStart,
        timeEnd: orderLink.slot.timeEnd,
        location: {
          name: orderLink.slot.location.name,
          address: orderLink.slot.location.address,
          city: orderLink.slot.location.city,
        },
      },
      wasRecommended: orderLink.wasRecommended,
      createdAt: orderLink.createdAt,
    });
  } catch (error) {
    console.error("Order lookup error:", error);
    return json(
      { error: "Failed to retrieve order information" },
      { status: 500 }
    );
  }
}
