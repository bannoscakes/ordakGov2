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
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { postcodeMatchesZone } from "../utils/postcode-match.server";
import { validateRequest, eligibilityCheckSchema } from "../utils/validation.server";

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
  // Matched delivery zone with its basePrice. Null for pickup or no match.
  // basePrice is a Decimal serialized as a string (e.g. "30.00").
  matchedZone?: {
    id: string;
    name: string;
    basePrice: string;
  } | null;
  message?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  // Captured outside the try so the catch block can log them when an
  // exception is thrown after they've been parsed but before the response
  // is built.
  let attemptedPostcode: string | undefined;
  let attemptedShopDomain: string | undefined;

  // F3 fix: this inner action is reachable directly at /api/eligibility/check
  // because Remix exposes every file in app/routes/. Without the proxy
  // auth gate here, anonymous callers could enumerate zone names, base
  // prices, and location addresses across every installed shop. The
  // proxy wrapper at apps.proxy.eligibility.check authenticates first;
  // re-authenticate here so direct hits to the bare URL fail.
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json<EligibilityResponse>(
      {
        eligible: false,
        locations: [],
        services: { delivery: false, pickup: false },
        message: "Unauthorized",
      },
      { status: 401, headers: getCorsHeaders(request) },
    );
  }

  try {
    // Validate request body with Zod
    const validation = await validateRequest(request, eligibilityCheckSchema);
    if (validation.error) {
      return validation.error;
    }

    // shopDomain is pinned to session.shop — the body's value is replayed
    // by appProxyAction from session.shop and ignored here so a direct
    // caller can't impersonate another shop even if they somehow got a
    // valid signature for shop A and supplied shopDomain=shop-B in body.
    const { postcode, fulfillmentType } = validation.data;
    const shopDomain = session.shop;
    attemptedPostcode = postcode;
    attemptedShopDomain = shopDomain;

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

    // Ordered to agree with carrier-service and slot recommendations: highest
    // priority wins, ties broken deterministically by id ascending.
    const zones = await prisma.zone.findMany({
      where: {
        shopId: shop.id,
        isActive: true,
      },
      orderBy: [{ priority: "desc" }, { id: "asc" }],
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

    const matchingZones = zones.filter(
      (zone) => zone.location.isActive && postcodeMatchesZone(postcode, zone),
    );

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

    // Only set matchedZone for delivery requests where the location can
    // actually fulfill a delivery — otherwise the cart-block would render
    // "Delivery fee: $X" alongside "no service" copy, and the carrier
    // service callback would correctly produce no rate at checkout.
    let matchedZone: EligibilityResponse["matchedZone"] = null;
    if (fulfillmentType === "delivery") {
      const top = matchingZones.find((z) => z.location.supportsDelivery);
      if (top) {
        matchedZone = {
          id: top.id,
          name: top.name,
          basePrice: top.basePrice.toString(),
        };
      }
    }

    // Generic message kept short. The cart-block composes the
    // customer-facing copy from `matchedZone.basePrice` so that string lives
    // with the rest of the storefront UI, not in this API.
    const message =
      filteredLocations.length > 0
        ? `Service available from ${filteredLocations.length} location${filteredLocations.length !== 1 ? "s" : ""}`
        : fulfillmentType
          ? `No ${fulfillmentType} service available in your area`
          : "Service available, but not for the selected fulfillment type";

    return json<EligibilityResponse>(
      {
        eligible: filteredLocations.length > 0,
        locations: filteredLocations,
        services,
        matchedZone,
        message,
      },
      { headers: getCorsHeaders(request) }
    );
  } catch (error) {
    logger.error("Eligibility check error", error, {
      postcode: attemptedPostcode,
      shopDomain: attemptedShopDomain,
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
