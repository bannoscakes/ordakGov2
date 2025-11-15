/**
 * POST /api/recommendations/locations
 * Returns ranked pickup location recommendations based on distance and capacity
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { scoreLocations } from "../services";
import type {
  LocationRecommendationInput,
  CustomerContext,
} from "../services";
import { validateRequest, recommendationLocationSchema } from "../utils/validation.server";

interface RequestBody {
  postcode?: string;
  address?: string;
  customerId?: string;
  customerEmail?: string;
  deliveryAddress?: {
    latitude?: number;
    longitude?: number;
    postcode?: string;
  };
  fulfillmentType?: "pickup" | "delivery";
}

export async function action({ request }: ActionFunctionArgs) {
  // Authenticate the request
  const { session } = await authenticate.public.appProxy(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Validate request body
    const validation = await validateRequest(request, recommendationLocationSchema);
    if (validation.error) {
      return validation.error;
    }

    const body = validation.data;

    // Get shop settings
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session?.shop || "" },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    // Check if recommendations are enabled
    if (!shop.recommendationsEnabled) {
      return json(
        { error: "Recommendations are disabled for this shop" },
        { status: 403 }
      );
    }

    // Fetch active locations
    const locations = await prisma.location.findMany({
      where: {
        shopId: shop.id,
        isActive: true,
        ...(body.fulfillmentType === "pickup"
          ? { supportsPickup: true }
          : {}),
      },
      include: {
        slots: {
          where: {
            isActive: true,
            date: {
              gte: new Date(), // Only future slots
            },
          },
          select: {
            capacity: true,
            booked: true,
          },
        },
      },
    });

    if (locations.length === 0) {
      return json({
        locations: [],
        message: "No active locations found",
      });
    }

    // Transform locations to scoring input format
    const locationInputs: LocationRecommendationInput[] = locations.map(
      (location) => {
        // Calculate total capacity and available capacity from slots
        const totalCapacity = location.slots.reduce(
          (sum, slot) => sum + slot.capacity,
          0
        );
        const bookedCapacity = location.slots.reduce(
          (sum, slot) => sum + slot.booked,
          0
        );
        const availableCapacity = totalCapacity - bookedCapacity;

        return {
          locationId: location.id,
          name: location.name,
          address: location.address,
          latitude: location.latitude ?? undefined,
          longitude: location.longitude ?? undefined,
          totalCapacity,
          availableCapacity,
          supportsDelivery: location.supportsDelivery,
          supportsPickup: location.supportsPickup,
        };
      }
    );

    // Build customer context
    const customerContext: CustomerContext | undefined =
      body.customerId || body.customerEmail || body.deliveryAddress
        ? {
            customerId: body.customerId,
            customerEmail: body.customerEmail,
            deliveryAddress: body.deliveryAddress,
          }
        : undefined;

    // Fetch customer preferences if we have an identifier
    if (customerContext && (body.customerId || body.customerEmail)) {
      const preferences = await prisma.customerPreferences.findFirst({
        where: {
          OR: [
            { customerId: body.customerId },
            { customerEmail: body.customerEmail },
          ],
        },
      });

      if (preferences) {
        customerContext.preferences = {
          preferredDays: preferences.preferredDays,
          preferredTimes: preferences.preferredTimes,
          preferredLocationIds: preferences.preferredLocationIds,
        };
      }
    }

    // Calculate recommendation scores
    const recommendations = scoreLocations(
      locationInputs,
      {
        capacityWeight: shop.capacityWeight,
        distanceWeight: shop.distanceWeight,
        routeEfficiencyWeight: shop.routeEfficiencyWeight,
        personalizationWeight: shop.personalizationWeight,
      },
      customerContext
    );

    // Format response
    const response = {
      locations: recommendations.map((rec) => ({
        locationId: rec.id,
        name: rec.location.name,
        address: rec.location.address,
        latitude: rec.location.latitude,
        longitude: rec.location.longitude,
        recommendationScore: rec.recommendationScore,
        recommended: rec.recommended,
        reason: rec.reason,
        distanceKm: rec.distanceKm,
        availableCapacity: rec.location.availableCapacity,
        totalCapacity: rec.location.totalCapacity,
        supportsDelivery: rec.location.supportsDelivery,
        supportsPickup: rec.location.supportsPickup,
        factors: {
          capacity: rec.factors.capacityScore,
          distance: rec.factors.distanceScore,
          routeEfficiency: rec.factors.routeEfficiencyScore,
          personalization: rec.factors.personalizationScore,
        },
      })),
      meta: {
        totalLocations: recommendations.length,
        recommendedCount: recommendations.filter((r) => r.recommended).length,
        hasCoordinates: Boolean(
          body.deliveryAddress?.latitude && body.deliveryAddress?.longitude
        ),
      },
    };

    return json(response);
  } catch (error) {
    logger.error("Error in recommendations/locations API", error);
    return json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
