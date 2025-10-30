/**
 * POST /api/events/recommendation-viewed
 * Tracks when a customer views recommended slots or locations
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface RequestBody {
  sessionId: string;
  customerId?: string;
  customerEmail?: string;
  shopifyDomain: string;
  recommendations: Array<{
    type: "slot" | "location";
    id: string;
    recommendationScore: number;
  }>;
}

export async function action({ request }: ActionFunctionArgs) {
  // Authenticate the request
  await authenticate.public.appProxy(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body: RequestBody = await request.json();

    // Validate required fields
    if (!body.sessionId || !body.shopifyDomain || !body.recommendations) {
      return json(
        { error: "sessionId, shopifyDomain, and recommendations are required" },
        { status: 400 }
      );
    }

    // Extract slot and location IDs
    const recommendedSlotIds = body.recommendations
      .filter((r) => r.type === "slot")
      .map((r) => r.id);

    const recommendedLocationIds = body.recommendations
      .filter((r) => r.type === "location")
      .map((r) => r.id);

    // Save to RecommendationLog
    const log = await prisma.recommendationLog.create({
      data: {
        sessionId: body.sessionId,
        customerId: body.customerId,
        customerEmail: body.customerEmail,
        shopifyDomain: body.shopifyDomain,
        recommendedSlotIds,
        recommendedLocationIds,
        viewedAt: new Date(),
      },
    });

    // Also save to EventLog for audit trail
    await prisma.eventLog.create({
      data: {
        eventType: "recommendation.viewed",
        payload: JSON.stringify({
          sessionId: body.sessionId,
          customerId: body.customerId,
          shopifyDomain: body.shopifyDomain,
          recommendations: body.recommendations,
          logId: log.id,
        }),
        timestamp: new Date(),
      },
    });

    return json({
      success: true,
      logId: log.id,
      message: "Recommendation view tracked successfully",
    });
  } catch (error) {
    console.error("Error tracking recommendation.viewed:", error);
    return json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
