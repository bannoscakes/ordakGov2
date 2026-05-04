/**
 * Carrier Service rate callback
 *
 * Shopify POSTs to this URL during checkout to fetch shipping options. The
 * URL is registered via `carrierServiceCreate` (see app/services/
 * carrier-service.server.ts). We respond with `{ rates: [...] }` — an empty
 * rates array means "no shipping options available," which Shopify surfaces
 * to the customer as a checkout error (intentional: gates checkout when the
 * destination isn't in a delivery zone we serve).
 *
 * Auth model: the URL itself is the secret (only Shopify knows it after
 * registration). We additionally trust `X-Shopify-Shop-Domain` to scope
 * lookups. For production-grade defense-in-depth, add a per-shop token in
 * the URL path and validate.
 *
 * Pricing (D4): rate is computed from our DB, not from Shopify's flat-rate
 * config. Total = `zone.basePrice + slot.priceAdjustment` (delivery) or
 * `slot.priceAdjustment` (pickup, typically 0). Both values are configured
 * by the merchant in the per-zone admin (D3).
 *
 * How we know which selections the customer made: cart attributes are NOT
 * included in the carrier service rate request body. The cart-block mirrors
 * its selections onto every line item as `_`-prefixed properties (e.g.
 * `_delivery_method`, `_slot_id`, `_location_id`, optional `_zone_id`).
 * Those DO appear at `rate.items[*].properties` and are the contract this
 * callback reads.
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import type { Slot, Zone } from "@prisma/client";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

interface RateRequestItem {
  name?: string;
  sku?: string;
  quantity?: number;
  price?: number;
  grams?: number;
  vendor?: string;
  requires_shipping?: boolean;
  properties?: Record<string, string>;
}

interface RateRequestAddress {
  country?: string;
  postal_code?: string;
  province?: string;
  city?: string;
  address1?: string;
  address2?: string;
}

interface RateRequest {
  rate: {
    origin: RateRequestAddress;
    destination: RateRequestAddress;
    items: RateRequestItem[];
    currency: string;
    locale?: string;
  };
}

interface RateResponse {
  service_name: string;
  service_code: string;
  total_price: string; // cents as string, e.g. "1500" = $15.00
  description: string;
  currency: string;
  min_delivery_date?: string;
  max_delivery_date?: string;
}

function normalizePostcode(postcode: string | undefined | null): string {
  return (postcode ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Decide whether a destination postcode falls inside a zone.
 * - postcode_list: exact match against zone.postcodes, MINUS excludePostcodes
 * - postcode_range: lexicographic compare against range[0]..range[1] (works
 *   for AU/NZ/UK/most numeric postcodes), MINUS excludePostcodes
 * - radius: not handled here (would need destination geocoding); returns false
 */
function postcodeMatchesZone(
  postcode: string,
  zone: Pick<Zone, "type" | "postcodes" | "excludePostcodes">,
): boolean {
  const target = normalizePostcode(postcode);
  if (!target) return false;

  // Always honor exclusion list first, regardless of zone type.
  if (zone.excludePostcodes?.some((p) => normalizePostcode(p) === target)) {
    return false;
  }

  if (zone.type === "postcode_list") {
    return zone.postcodes.some((p) => normalizePostcode(p) === target);
  }
  if (zone.type === "postcode_range") {
    if (zone.postcodes.length < 2) return false;
    const start = normalizePostcode(zone.postcodes[0]);
    const end = normalizePostcode(zone.postcodes[1]);
    return target >= start && target <= end;
  }
  // radius: needs lat/lng for the destination, which Shopify doesn't supply
  // in the rate request. Future work — geocode the postal_code to coords.
  return false;
}

/**
 * Pull a shared property value from line items. Carts can have multiple
 * lines, but the cart-block writes the SAME selection across all lines, so
 * we read the first non-empty value.
 */
function readLineItemProperty(
  items: RateRequestItem[],
  key: string,
): string | undefined {
  for (const item of items) {
    const value = item.properties?.[key];
    if (value && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Convert a Decimal-from-Prisma (string) or number into integer cents.
 * Uses banker's rounding for half-cent edge cases.
 */
function toCents(amount: { toString(): string } | number | null | undefined): number {
  if (amount == null) return 0;
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export async function action({ request }: ActionFunctionArgs) {
  // Wrap the entire callback in try/catch returning `{ rates: [] }` on any
  // uncaught throw. The deliberate failure mode for THIS endpoint is "no
  // rates" (which gates checkout intentionally) — NOT a 500. Shopify treats
  // repeated 5xx responses as a carrier-service health failure and can
  // suppress the carrier service entirely.
  let shopifyDomain = request.headers.get("x-shopify-shop-domain") ?? undefined;
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    if (!shopifyDomain) {
      logger.warn("Carrier service request missing X-Shopify-Shop-Domain header");
      return json({ rates: [] });
    }

    let body: RateRequest;
    try {
      body = (await request.json()) as RateRequest;
    } catch (err) {
      logger.error("Carrier service: invalid JSON body", err, { shopifyDomain });
      return json({ rates: [] });
    }

    const { rate } = body;
    if (!rate?.destination || !Array.isArray(rate.items)) {
      logger.warn("Carrier service: malformed rate body", { shopifyDomain });
      return json({ rates: [] });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain },
      select: { id: true },
    });
    if (!shop) {
      logger.warn("Carrier service: unknown shop", { shopifyDomain });
      return json({ rates: [] });
    }

    const deliveryMethod = readLineItemProperty(rate.items, "_delivery_method");
    const requestedLocationId = readLineItemProperty(rate.items, "_location_id");
    const requestedZoneId = readLineItemProperty(rate.items, "_zone_id");
    const requestedSlotId = readLineItemProperty(rate.items, "_slot_id");

    // Look up the cart-selected slot for its priceAdjustment. Used by both
    // delivery and pickup branches.
    let selectedSlot: Slot | null = null;
    if (requestedSlotId) {
      selectedSlot = await prisma.slot.findUnique({ where: { id: requestedSlotId } });
    }

    // ---------- Pickup branch ----------
    if (deliveryMethod === "pickup") {
      const pickupLocation = await prisma.location.findFirst({
        where: {
          shopId: shop.id,
          isActive: true,
          supportsPickup: true,
          ...(requestedLocationId ? { id: requestedLocationId } : {}),
        },
      });

      if (!pickupLocation) {
        logger.info("Carrier service: pickup requested but no eligible location", {
          shopifyDomain,
          requestedLocationId,
        });
        return json({ rates: [] });
      }

      const pickupCents = toCents(selectedSlot?.priceAdjustment);
      const rates: RateResponse[] = [
        {
          service_name: `Pickup at ${pickupLocation.name}`,
          service_code: `ORDAK_PICKUP_${pickupLocation.id}`,
          total_price: String(pickupCents),
          description:
            pickupCents > 0
              ? `Pick up your order from ${pickupLocation.name}`
              : `Pick up your order from ${pickupLocation.name} (free)`,
          currency: rate.currency,
        },
      ];
      return json({ rates });
    }

    // ---------- Delivery branch ----------
    // Prefer the cart-selected zone if cart-block stamped _zone_id (future);
    // otherwise re-match the destination postcode server-side.
    let matchedZone: Zone | null = null;

    if (requestedZoneId) {
      const candidate = await prisma.zone.findFirst({
        where: {
          id: requestedZoneId,
          shopId: shop.id,
          isActive: true,
          location: { isActive: true, supportsDelivery: true },
        },
        include: { location: true },
      });
      if (candidate) matchedZone = candidate;
    }

    if (!matchedZone) {
      const destinationPostcode = rate.destination.postal_code;
      const candidates = await prisma.zone.findMany({
        where: {
          shopId: shop.id,
          isActive: true,
          location: { isActive: true, supportsDelivery: true },
        },
        orderBy: { priority: "desc" },
        include: { location: true },
      });
      matchedZone =
        candidates.find((z) => postcodeMatchesZone(destinationPostcode ?? "", z)) ?? null;
    }

    if (!matchedZone) {
      // No matching zone for the destination — gate checkout (empty rates).
      return json({ rates: [] });
    }

    // Sanity check: if cart-block told us a slot, make sure it's actually for
    // this zone. If a customer somehow has a stale slot from a different zone
    // in their cart attrs, refuse the rate so they re-pick. Prevents
    // mis-billing if the slot's priceAdjustment was meant for a different zone.
    if (selectedSlot && selectedSlot.zoneId && selectedSlot.zoneId !== matchedZone.id) {
      logger.warn("Carrier service: slot/zone mismatch", {
        shopifyDomain,
        selectedSlotId: selectedSlot.id,
        selectedSlotZoneId: selectedSlot.zoneId,
        matchedZoneId: matchedZone.id,
      });
      return json({ rates: [] });
    }

    const baseCents = toCents(matchedZone.basePrice);
    const adjustmentCents = toCents(selectedSlot?.priceAdjustment);
    const totalCents = baseCents + adjustmentCents;

    // Only mention the adjustment in the description if it's actually
    // non-zero — keeps the checkout label clean for the common $0 case.
    const description =
      adjustmentCents > 0
        ? `Scheduled delivery (zone ${matchedZone.name}, +$${(adjustmentCents / 100).toFixed(2)} slot premium)`
        : `Scheduled delivery (zone ${matchedZone.name})`;

    const rateResponse: RateResponse = {
      service_name: "Standard delivery",
      service_code: `ORDAK_DELIVERY_${matchedZone.id}`,
      total_price: String(totalCents),
      description,
      currency: rate.currency,
    };

    return json({ rates: [rateResponse] });
  } catch (err) {
    logger.error("Carrier service: uncaught throw — returning empty rates", err, {
      shopifyDomain,
    });
    return json({ rates: [] });
  }
}
