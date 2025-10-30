/**
 * POST /api/events/recommendation-selected
 * Tracks when a customer selects a recommended slot or location
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface RequestBody {
  sessionId: string;
  customerId?: string;
  customerEmail?: string;
  shopifyDomain: string;
  selected: {
    type: "slot" | "location";
    id: string;
    recommendationScore?: number;
    wasRecommended: boolean;
  };
  alternativesShown?: string[];
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
    if (
      !body.sessionId ||
      !body.shopifyDomain ||
      !body.selected ||
      !body.selected.id ||
      !body.selected.type
    ) {
      return json(
        {
          error:
            "sessionId, shopifyDomain, and selected (with id and type) are required",
        },
        { status: 400 }
      );
    }

    // Find the existing log entry for this session (if exists)
    const existingLog = await prisma.recommendationLog.findFirst({
      where: {
        sessionId: body.sessionId,
        shopifyDomain: body.shopifyDomain,
      },
      orderBy: {
        viewedAt: "desc",
      },
    });

    if (existingLog) {
      // Update the existing log with selection info
      await prisma.recommendationLog.update({
        where: { id: existingLog.id },
        data: {
          selectedSlotId:
            body.selected.type === "slot" ? body.selected.id : undefined,
          selectedLocationId:
            body.selected.type === "location" ? body.selected.id : undefined,
          wasRecommended: body.selected.wasRecommended,
          alternativesShown: body.alternativesShown || [],
          selectedAt: new Date(),
        },
      });
    } else {
      // Create a new log entry if none exists
      await prisma.recommendationLog.create({
        data: {
          sessionId: body.sessionId,
          customerId: body.customerId,
          customerEmail: body.customerEmail,
          shopifyDomain: body.shopifyDomain,
          recommendedSlotIds: [],
          recommendedLocationIds: [],
          selectedSlotId:
            body.selected.type === "slot" ? body.selected.id : undefined,
          selectedLocationId:
            body.selected.type === "location" ? body.selected.id : undefined,
          wasRecommended: body.selected.wasRecommended,
          alternativesShown: body.alternativesShown || [],
          viewedAt: new Date(),
          selectedAt: new Date(),
        },
      });
    }

    // Also save to EventLog for audit trail
    await prisma.eventLog.create({
      data: {
        eventType: "recommendation.selected",
        payload: JSON.stringify({
          sessionId: body.sessionId,
          customerId: body.customerId,
          shopifyDomain: body.shopifyDomain,
          selected: body.selected,
          alternativesShown: body.alternativesShown,
        }),
        timestamp: new Date(),
      },
    });

    // Update customer preferences if we have customer identifier
    if (body.customerId || body.customerEmail) {
      const selectedDateTime = await getSelectedSlotDateTime(body.selected.id, body.selected.type);

      if (selectedDateTime) {
        await updateCustomerPreferences(
          body.customerId,
          body.customerEmail,
          selectedDateTime,
          body.selected.id,
          body.selected.type
        );
      }
    }

    return json({
      success: true,
      message: "Recommendation selection tracked successfully",
    });
  } catch (error) {
    console.error("Error tracking recommendation.selected:", error);
    return json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Get the date/time of the selected slot for preference tracking
 */
async function getSelectedSlotDateTime(
  id: string,
  type: "slot" | "location"
): Promise<{ day: string; time: string; locationId?: string } | null> {
  if (type === "slot") {
    const slot = await prisma.slot.findUnique({
      where: { id },
      select: { date: true, timeStart: true, timeEnd: true, locationId: true },
    });

    if (slot) {
      return {
        day: slot.date.toLocaleDateString("en-US", { weekday: "long" }),
        time: `${slot.timeStart}-${slot.timeEnd}`,
        locationId: slot.locationId,
      };
    }
  } else if (type === "location") {
    return {
      day: "",
      time: "",
      locationId: id,
    };
  }

  return null;
}

/**
 * Update customer preferences based on selection
 */
async function updateCustomerPreferences(
  customerId: string | undefined,
  customerEmail: string | undefined,
  selectedDateTime: { day: string; time: string; locationId?: string },
  selectedId: string,
  selectedType: "slot" | "location"
): Promise<void> {
  if (!customerId && !customerEmail) return;

  // Find or create customer preferences
  let preferences = await prisma.customerPreferences.findFirst({
    where: {
      OR: [
        { customerId: customerId },
        { customerEmail: customerEmail },
      ].filter((condition) => Object.values(condition)[0]), // Filter out undefined
    },
  });

  if (!preferences) {
    // Create new preferences
    preferences = await prisma.customerPreferences.create({
      data: {
        customerId,
        customerEmail,
        preferredDays: selectedDateTime.day ? [selectedDateTime.day] : [],
        preferredTimes: selectedDateTime.time ? [selectedDateTime.time] : [],
        preferredLocationIds: selectedDateTime.locationId
          ? [selectedDateTime.locationId]
          : [],
        totalOrders: 1,
        lastOrderDate: new Date(),
      },
    });
  } else {
    // Update existing preferences
    const updatedData: any = {
      totalOrders: preferences.totalOrders + 1,
      lastOrderDate: new Date(),
    };

    // Add to preferred days if not already present
    if (
      selectedDateTime.day &&
      !preferences.preferredDays.includes(selectedDateTime.day)
    ) {
      updatedData.preferredDays = [
        ...preferences.preferredDays,
        selectedDateTime.day,
      ];
    }

    // Add to preferred times if not already present
    if (
      selectedDateTime.time &&
      !preferences.preferredTimes.includes(selectedDateTime.time)
    ) {
      updatedData.preferredTimes = [
        ...preferences.preferredTimes,
        selectedDateTime.time,
      ];
    }

    // Add to preferred locations if not already present
    if (
      selectedDateTime.locationId &&
      !preferences.preferredLocationIds.includes(selectedDateTime.locationId)
    ) {
      updatedData.preferredLocationIds = [
        ...preferences.preferredLocationIds,
        selectedDateTime.locationId,
      ];
    }

    await prisma.customerPreferences.update({
      where: { id: preferences.id },
      data: updatedData,
    });
  }
}
