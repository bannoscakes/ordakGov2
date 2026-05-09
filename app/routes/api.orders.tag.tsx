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

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { recordEvent } from "../services/event-log.server";

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
    // Authenticate the request (app proxy). 401 on direct hits to the
    // bare /api/orders/tag URL.
    const { session } = await authenticate.public.appProxy(request);
    if (!session) {
      return json<OrderTagResponse>(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

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

    // Resolve shop row up front so slot + orderLink lookups can be
    // shop-scoped (F4a fix). Without this, an authenticated customer of
    // shop A could pass slotId of shop B and create a cross-tenant
    // booking — incrementing shop B's slot.booked, dispatching shop B's
    // webhook destinations with shop A's order data, etc.
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shopRecord) {
      return json<OrderTagResponse>(
        { success: false, error: "Shop not found" },
        { status: 404 },
      );
    }

    // Find the slot — shop-scoped via location.shopId. findFirst returns
    // null for slots that belong to another tenant.
    const slot = await prisma.slot.findFirst({
      where: {
        id: slotId,
        location: { shopId: shopRecord.id },
      },
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
            shopId: true,
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

    // Check if order already linked — shop-scoped so an order id that
    // exists at another shop doesn't trigger a false "already linked"
    // failure here.
    const existingLink = await prisma.orderLink.findFirst({
      where: {
        shopifyOrderId: orderId,
        slot: { location: { shopId: shopRecord.id } },
      },
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

    // Log + dispatch to webhook destinations.
    await recordEvent({
      shopId: slot.location.shopId,
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
    logger.error("Order tagging error", error);
    return json<OrderTagResponse>(
      {
        success: false,
        error: "Failed to tag order",
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve order scheduling info. F4b fix: previously
// this loader had zero authentication and trusted orderId from the
// query string, returning the customer's pickup/delivery address and
// scheduled time for any order across any shop. Now requires admin
// session and shop-scopes the OrderLink lookup so admins can only see
// their own shop's orders.
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");

    if (!orderId) {
      return json(
        { error: "Order ID is required" },
        { status: 400 }
      );
    }

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    const orderLink = await prisma.orderLink.findFirst({
      where: {
        shopifyOrderId: orderId,
        slot: { location: { shopId: shop.id } },
      },
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
    logger.error("Order lookup error", error);
    return json(
      { error: "Failed to retrieve order information" },
      { status: 500 }
    );
  }
}
