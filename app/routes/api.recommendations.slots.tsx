/**
 * POST /api/recommendations/slots
 * Returns ranked slot recommendations based on customer context and shop settings
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { scoreSlots } from "../services";
import { postcodeMatchesZone } from "../utils/postcode-match.server";
import { isSlotCutoffPassed } from "../services/slot-cutoff.server";
import type {
  SlotRecommendationInput,
  CustomerContext,
  OtherDelivery,
} from "../services";

interface RequestBody {
  postcode?: string;
  cartItems?: string[];
  customerId?: string;
  customerEmail?: string;
  fulfillmentType: "delivery" | "pickup";
  locationId?: string;
  deliveryAddress?: {
    latitude?: number;
    longitude?: number;
    postcode?: string;
  };
  dateRange?: {
    startDate: string; // ISO date
    endDate: string; // ISO date
  };
}

export async function action({ request }: ActionFunctionArgs) {
  // Authenticate the request
  const { session } = await authenticate.public.appProxy(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body: RequestBody = await request.json();

    // Validate required fields
    if (!body.fulfillmentType) {
      return json(
        { error: "fulfillmentType is required" },
        { status: 400 }
      );
    }

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

    // Determine date range (default: next 7 days)
    const startDate = body.dateRange?.startDate
      ? new Date(body.dateRange.startDate)
      : new Date();
    const endDate = body.dateRange?.endDate
      ? new Date(body.dateRange.endDate)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // For delivery, narrow slot results to the single zone matching the
    // customer's postcode (highest priority, ties broken by id ascending so
    // the result agrees with eligibility check and carrier service).
    // Pickup ignores zoneId — pickup slots aren't postcode-bound.
    let zoneIdFilter: string | null = null;
    if (body.fulfillmentType === "delivery" && body.postcode) {
      const candidates = await prisma.zone.findMany({
        where: {
          shopId: shop.id,
          isActive: true,
          location: { isActive: true, supportsDelivery: true },
        },
        orderBy: [{ priority: "desc" }, { id: "asc" }],
        select: { id: true, type: true, postcodes: true, excludePostcodes: true },
      });
      const matched = candidates.find((z) => postcodeMatchesZone(body.postcode!, z));
      if (matched) {
        zoneIdFilter = matched.id;
      } else {
        logger.info("Slots API: no matching delivery zone", {
          shopDomain: session?.shop,
          postcode: body.postcode,
          candidateCount: candidates.length,
        });
        return json({ slots: [], message: "No service available for this postcode" });
      }
    }

    const candidateSlots = await prisma.slot.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        fulfillmentType: body.fulfillmentType,
        isActive: true,
        booked: { lt: prisma.slot.fields.capacity },
        ...(body.fulfillmentType === "delivery" ? { zoneId: zoneIdFilter } : {}),
        ...(body.locationId ? { locationId: body.locationId } : {}),
      },
      include: {
        location: {
          select: { id: true, name: true, latitude: true, longitude: true, timezone: true },
        },
      },
      orderBy: { date: "asc" },
    });

    // Cutoff filter — drop slots whose per-slot cutoff has passed in the
    // location's local clock. Done in JS post-query because date+timeStart+tz
    // arithmetic is awkward in pure Prisma `where`. N is small (date-bounded
    // result set). Per-location timezone is used (not shop-level) because
    // multi-location merchants can ship from stores in different time zones.
    const now = new Date();
    const slots = candidateSlots.filter(
      (s) => !isSlotCutoffPassed(s, now, s.location.timezone),
    );
    const cutoffSuppressedCount = candidateSlots.length - slots.length;

    if (slots.length === 0) {
      // Distinct from "no zone matches" — here a zone DID match but no live
      // Slot rows exist in the requested date range. Two sub-cases:
      //  - Nothing was even materialized for the range (merchant hasn't
      //    configured templates yet).
      //  - Slots existed but every one had its per-slot cutoff pass.
      // Log them separately so the merchant can audit each cause.
      if (cutoffSuppressedCount > 0 && candidateSlots.length === cutoffSuppressedCount) {
        logger.info("Slots API: all slots in range past cutoff", {
          shopDomain: session?.shop,
          postcode: body.postcode,
          zoneIdFilter,
          fulfillmentType: body.fulfillmentType,
          startDate: startDate.toISOString().slice(0, 10),
          endDate: endDate.toISOString().slice(0, 10),
          cutoffSuppressedCount,
        });
      } else {
        logger.info("Slots API: zone matched but no available slots", {
          shopDomain: session?.shop,
          postcode: body.postcode,
          zoneIdFilter,
          fulfillmentType: body.fulfillmentType,
          startDate: startDate.toISOString().slice(0, 10),
          endDate: endDate.toISOString().slice(0, 10),
        });
      }
      return json({
        slots: [],
        message: "No available slots found in the specified date range",
      });
    }

    // Transform slots to scoring input format
    const slotInputs: SlotRecommendationInput[] = slots.map((slot) => ({
      slotId: slot.id,
      date: slot.date,
      timeStart: slot.timeStart,
      timeEnd: slot.timeEnd,
      capacity: slot.capacity,
      booked: slot.booked,
      locationId: slot.locationId,
      fulfillmentType: slot.fulfillmentType as "delivery" | "pickup",
      location: {
        latitude: slot.location.latitude ?? undefined,
        longitude: slot.location.longitude ?? undefined,
      },
    }));

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

    // Fetch other scheduled deliveries for route efficiency (if delivery type)
    let otherDeliveries: OtherDelivery[] = [];
    if (body.fulfillmentType === "delivery") {
      const scheduledOrders = await prisma.orderLink.findMany({
        where: {
          fulfillmentType: "delivery",
          status: "scheduled",
          slot: {
            date: {
              gte: startDate,
              lte: endDate,
            },
          },
        },
        include: {
          slot: {
            include: {
              location: {
                select: {
                  latitude: true,
                  longitude: true,
                },
              },
            },
          },
        },
      });

      otherDeliveries = scheduledOrders
        .filter(
          (order) =>
            order.slot.location.latitude && order.slot.location.longitude
        )
        .map((order) => ({
          latitude: order.slot.location.latitude!,
          longitude: order.slot.location.longitude!,
          scheduledDate: order.slot.date,
          timeStart: order.slot.timeStart,
        }));
    }

    // Calculate recommendation scores
    const recommendations = scoreSlots(
      slotInputs,
      {
        capacityWeight: shop.capacityWeight,
        distanceWeight: shop.distanceWeight,
        routeEfficiencyWeight: shop.routeEfficiencyWeight,
        personalizationWeight: shop.personalizationWeight,
      },
      customerContext,
      otherDeliveries
    );

    // priceAdjustment + zoneId aren't on SlotRecommendationInput — re-attach
    // from the source rows so the cart-block can format priceAdjustment on
    // the tile AND stamp zoneId onto cart line item properties (`_zone_id`)
    // for the Carrier Service callback. Without _zone_id the callback falls
    // back to a postcode scan that may match a different overlapping zone
    // than the one the cart-block resolved.
    const priceAdjustmentById = new Map<string, string>();
    const zoneIdById = new Map<string, string | null>();
    for (const s of slots) {
      priceAdjustmentById.set(s.id, s.priceAdjustment.toString());
      zoneIdById.set(s.id, s.zoneId);
    }

    // Format response
    const response = {
      slots: recommendations.map((rec) => ({
        slotId: rec.id,
        date: rec.slot.date.toISOString().split("T")[0],
        timeStart: rec.slot.timeStart,
        timeEnd: rec.slot.timeEnd,
        recommendationScore: rec.recommendationScore,
        recommended: rec.recommended,
        reason: rec.reason,
        capacityRemaining: rec.slot.capacity - rec.slot.booked,
        capacity: rec.slot.capacity,
        priceAdjustment: priceAdjustmentById.get(rec.id) ?? "0",
        locationId: rec.slot.locationId,
        zoneId: zoneIdById.get(rec.id) ?? null,
        fulfillmentType: rec.slot.fulfillmentType,
        factors: {
          capacity: rec.factors.capacityScore,
          distance: rec.factors.distanceScore,
          routeEfficiency: rec.factors.routeEfficiencyScore,
          personalization: rec.factors.personalizationScore,
        },
      })),
      meta: {
        totalSlots: recommendations.length,
        recommendedCount: recommendations.filter((r) => r.recommended).length,
        dateRange: {
          start: startDate.toISOString().split("T")[0],
          end: endDate.toISOString().split("T")[0],
        },
        // Widget appearance flags from Shop settings. Coalesce defaults so
        // an unapplied D7 migration (or a future column rename) can't
        // silently serialize undefined into the cart-block's state and
        // break the badge toggles. Defaults match post-D5 behavior.
        widgetAppearance: {
          showRecommendedBadge: shop.showRecommendedBadge ?? false,
          showMostAvailableBadge: shop.showMostAvailableBadge ?? true,
        },
      },
    };

    return json(response);
  } catch (error) {
    // Don't leak Prisma error messages (column names, query shapes) to
    // the storefront. Log the actual error server-side, return a generic
    // 500 to the cart-block.
    logger.error("Error in recommendations/slots API", error, {
      shopDomain: session?.shop,
    });
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
