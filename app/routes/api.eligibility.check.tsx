/**
 * Postcode Eligibility API
 * Check if a postcode is eligible for delivery/pickup services
 *
 * POST /api/eligibility/check
 * Body: { postcode: string, fulfillmentType?: "delivery" | "pickup" }
 *
 * Returns: {
 *   eligible: boolean,
 *   locations: Location[],
 *   services: { delivery: boolean, pickup: boolean }
 * }
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

interface EligibilityRequest {
  postcode: string;
  fulfillmentType?: "delivery" | "pickup";
  shopDomain: string;
}

interface EligibilityResponse {
  eligible: boolean;
  locations: {
    id: string;
    name: string;
    address: string;
    city: string | null;
    supportsDelivery: boolean;
    supportsPickup: boolean;
    distance?: number | null;
  }[];
  services: {
    delivery: boolean;
    pickup: boolean;
  };
  message?: string;
}

/**
 * Check if a postcode matches a zone
 */
function isPostcodeInZone(postcode: string, zone: any): boolean {
  const normalizedPostcode = postcode.trim().toUpperCase().replace(/\s+/g, "");

  switch (zone.type) {
    case "postcode_list":
      // Check if postcode is in the list
      if (!zone.postcodes || zone.postcodes.length === 0) return false;
      return zone.postcodes.some((zp: string) => {
        const normalized = zp.trim().toUpperCase().replace(/\s+/g, "");
        return normalized === normalizedPostcode;
      });

    case "postcode_range":
      // Check if postcode is within range
      if (!zone.postcodes || zone.postcodes.length < 2) return false;
      const start = zone.postcodes[0].trim().toUpperCase().replace(/\s+/g, "");
      const end = zone.postcodes[1].trim().toUpperCase().replace(/\s+/g, "");

      // Simple string comparison (works for numeric postcodes)
      // For more complex postcode systems, implement custom logic
      return normalizedPostcode >= start && normalizedPostcode <= end;

    case "radius":
      // For radius zones, we'd need customer's coordinates
      // Return true as a fallback (will be filtered by location coordinates later)
      // In a real implementation, you'd geocode the postcode and calculate distance
      return true;

    default:
      return false;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // This is a public endpoint (app proxy), no authentication required

  try {
    const body = await request.json();
    const { postcode, fulfillmentType, shopDomain } = body as EligibilityRequest;

    // Validation
    if (!postcode || typeof postcode !== "string") {
      return json<EligibilityResponse>(
        {
          eligible: false,
          locations: [],
          services: { delivery: false, pickup: false },
          message: "Postcode is required",
        },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    if (!shopDomain) {
      return json<EligibilityResponse>(
        {
          eligible: false,
          locations: [],
          services: { delivery: false, pickup: false },
          message: "Shop domain is required",
        },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    // Find the shop
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
    });

    if (!shop) {
      return json<EligibilityResponse>(
        {
          eligible: false,
          locations: [],
          services: { delivery: false, pickup: false },
          message: "Shop not found",
        },
        { status: 404, headers: getCorsHeaders(request) }
      );
    }

    // Find all active zones with their locations
    const zones = await prisma.zone.findMany({
      where: {
        shopId: shop.id,
        isActive: true,
      },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            latitude: true,
            longitude: true,
            isActive: true,
            supportsDelivery: true,
            supportsPickup: true,
          },
        },
      },
    });

    // Find matching zones
    const matchingZones = zones.filter((zone) => {
      // Only consider zones with active locations
      if (!zone.location.isActive) return false;

      // Check if postcode matches the zone
      return isPostcodeInZone(postcode, zone);
    });

    if (matchingZones.length === 0) {
      return json<EligibilityResponse>(
        {
          eligible: false,
          locations: [],
          services: { delivery: false, pickup: false },
          message: "No service available in your area",
        },
        { headers: getCorsHeaders(request) }
      );
    }

    // Get unique locations from matching zones
    const locationMap = new Map();
    matchingZones.forEach((zone) => {
      if (!locationMap.has(zone.location.id)) {
        locationMap.set(zone.location.id, {
          id: zone.location.id,
          name: zone.location.name,
          address: zone.location.address,
          city: zone.location.city,
          supportsDelivery: zone.location.supportsDelivery,
          supportsPickup: zone.location.supportsPickup,
          distance: null, // Would calculate distance if coordinates provided
        });
      }
    });

    const eligibleLocations = Array.from(locationMap.values());

    // Filter by fulfillment type if specified
    let filteredLocations = eligibleLocations;
    if (fulfillmentType === "delivery") {
      filteredLocations = eligibleLocations.filter((loc) => loc.supportsDelivery);
    } else if (fulfillmentType === "pickup") {
      filteredLocations = eligibleLocations.filter((loc) => loc.supportsPickup);
    }

    // Determine available services
    const services = {
      delivery: eligibleLocations.some((loc) => loc.supportsDelivery),
      pickup: eligibleLocations.some((loc) => loc.supportsPickup),
    };

    return json<EligibilityResponse>(
      {
        eligible: filteredLocations.length > 0,
        locations: filteredLocations,
        services,
        message:
          filteredLocations.length > 0
            ? `Service available from ${filteredLocations.length} location${filteredLocations.length !== 1 ? "s" : ""}`
            : fulfillmentType
            ? `No ${fulfillmentType} service available in your area`
            : "Service available, but not for the selected fulfillment type",
      },
      { headers: getCorsHeaders(request) }
    );
  } catch (error) {
    logger.error("Eligibility check error", error, {
      postcode: (error as any)?.postcode,
      shopDomain: (error as any)?.shopDomain
    });
    return json<EligibilityResponse>(
      {
        eligible: false,
        locations: [],
        services: { delivery: false, pickup: false },
        message: "An error occurred while checking eligibility",
      },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}

/**
 * Helper to get CORS headers
 * Allows requests from Shopify storefronts (*.myshopify.com and custom domains)
 */
function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");

  // Allow Shopify storefronts and local development
  const allowedOrigins = [
    /^https?:\/\/.*\.myshopify\.com$/,
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  ];

  const isAllowed = origin && allowedOrigins.some(pattern => pattern.test(origin));

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

// OPTIONS for CORS preflight
export async function loader({ request }: ActionFunctionArgs) {
  return json(
    { message: "Use POST to check eligibility" },
    { headers: getCorsHeaders(request) }
  );
}
