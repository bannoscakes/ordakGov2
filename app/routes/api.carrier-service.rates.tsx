/**
 * Carrier Service rate callback. Shopify POSTs here during checkout.
 *
 * Failure mode is "no rates" (empty array), NOT a 500. Repeated 5xx makes
 * Shopify mark the carrier service unhealthy and disable it, breaking
 * checkout for every customer until manual re-enable. So uncaught throws
 * collapse to `{ rates: [] }` with a logger.error trail.
 *
 * Total = `zone.basePrice + slot.priceAdjustment` for delivery, or
 * `slot.priceAdjustment` for pickup. Both come from our DB (per-zone admin),
 * NOT from Shopify's flat-rate config.
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import type { Slot, Zone } from "@prisma/client";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { postcodeMatchesZone } from "../utils/postcode-match.server";
import { isSlotCutoffPassed } from "../services/slot-cutoff.server";

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

class InvalidPriceError extends Error {}

/**
 * Pull a shared property value from line items. The cart-block writes the
 * SAME selection across all lines, so the first non-empty value wins.
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
 * `null` / `undefined` → 0 (legitimate: no slot premium configured).
 * NaN, non-finite, or negative → throw — these indicate data corruption
 * and the outer catch will collapse to empty rates so the customer can't
 * silently be billed $0 for a corrupt zone.basePrice.
 */
function toCents(amount: { toString(): string } | number | null | undefined): number {
  if (amount == null) return 0;
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  if (!Number.isFinite(n) || n < 0) {
    throw new InvalidPriceError(`toCents received invalid value: ${String(amount)}`);
  }
  return Math.round(n * 100);
}

export async function action({ request }: ActionFunctionArgs) {
  let shopifyDomain = request.headers.get("x-shopify-shop-domain") ?? undefined;
  // Captured outside the try so the catch can pin a thrown
  // InvalidPriceError to the specific entity that contained the bad value
  // (instead of just "something in this request had a corrupt decimal").
  let matchedZoneForLog: Pick<Zone, "id"> | null = null;
  let selectedSlotForLog: Pick<Slot, "id"> | null = null;
  let destinationPostcodeForLog: string | undefined;
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

    // Slot lookup is shop-scoped via location.shopId so a customer cannot
    // reference a slot from a different shop by stamping its id into
    // _slot_id. Per-branch fulfillmentType + zone/location guards apply
    // below. Pull the location's timezone for the cutoff check.
    let selectedSlot:
      | (Slot & { location: { timezone: string } })
      | null = null;
    if (requestedSlotId) {
      selectedSlot = await prisma.slot.findFirst({
        where: { id: requestedSlotId, location: { shopId: shop.id } },
        include: { location: { select: { timezone: true } } },
      });
      if (!selectedSlot) {
        logger.warn("Carrier service: requested slot not found in shop", {
          shopifyDomain,
          requestedSlotId,
        });
      } else {
        selectedSlotForLog = selectedSlot;
      }
    }

    // Defense-in-depth cutoff gate. The slot loader filters at cart-time, but
    // a customer can hold the cart open across the cutoff. Empty rates here
    // collapses checkout the same way a no-zone-match does. Per-location
    // timezone is used (matches the loader filter).
    //
    // If the location's tz is misconfigured the helper throws — log the
    // error and skip the gate (allowing the rate to compute) rather than
    // hard-blocking checkout for a tz typo. Failing-open here matches the
    // loader's failing-open behavior and keeps tz misconfig observable in
    // logs without nuking checkout.
    if (selectedSlot) {
      let cutoffPassed = false;
      try {
        cutoffPassed = isSlotCutoffPassed(
          selectedSlot,
          new Date(),
          selectedSlot.location.timezone,
        );
      } catch (err) {
        logger.warn("Carrier service: cutoff check failed — allowing rate", {
          shopifyDomain,
          slotId: selectedSlot.id,
          locationTimezone: selectedSlot.location.timezone,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (cutoffPassed) {
        logger.warn("Carrier service: requested slot past cutoff", {
          shopifyDomain,
          slotId: selectedSlot.id,
          cutoffOffsetMinutes: selectedSlot.cutoffOffsetMinutes,
        });
        return json({ rates: [] });
      }
    }

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

      // Reject a slot that doesn't belong to this pickup branch — wrong
      // fulfillment type, or different location. Avoids cross-contaminating
      // the pickup rate with a delivery slot's priceAdjustment.
      if (selectedSlot) {
        if (
          selectedSlot.fulfillmentType !== "pickup" ||
          selectedSlot.locationId !== pickupLocation.id
        ) {
          logger.warn("Carrier service: pickup slot mismatch", {
            shopifyDomain,
            selectedSlotId: selectedSlot.id,
            selectedSlotFulfillmentType: selectedSlot.fulfillmentType,
            selectedSlotLocationId: selectedSlot.locationId,
            pickupLocationId: pickupLocation.id,
          });
          return json({ rates: [] });
        }
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

    // Delivery: when the cart-block stamps _zone_id we still verify the
    // destination postcode actually falls in that zone — line item
    // properties are customer-writable, so trusting the id alone would let
    // a customer in zone B point at zone A and pay zone A's basePrice.
    let matchedZone: Zone | null = null;
    const destinationPostcode = rate.destination.postal_code ?? "";
    destinationPostcodeForLog = destinationPostcode;

    if (requestedZoneId) {
      const candidate = await prisma.zone.findFirst({
        where: {
          id: requestedZoneId,
          shopId: shop.id,
          isActive: true,
          location: { isActive: true, supportsDelivery: true },
        },
      });
      if (candidate && postcodeMatchesZone(destinationPostcode, candidate)) {
        matchedZone = candidate;
      }
    }

    if (!matchedZone) {
      const candidates = await prisma.zone.findMany({
        where: {
          shopId: shop.id,
          isActive: true,
          location: { isActive: true, supportsDelivery: true },
        },
        // Secondary sort by id keeps the match deterministic when zones
        // share a priority — eligibility, slot recommendations, and
        // carrier service all use the same ordering so the customer sees
        // the same zone everywhere.
        orderBy: [{ priority: "desc" }, { id: "asc" }],
      });
      matchedZone =
        candidates.find((z) => postcodeMatchesZone(destinationPostcode, z)) ?? null;

      if (!matchedZone) {
        logger.info("Carrier service: no matching delivery zone", {
          shopifyDomain,
          destinationPostcode,
          candidateCount: candidates.length,
        });
        return json({ rates: [] });
      }
    }

    // Delivery slot must match the resolved zone AND be a delivery slot.
    // Prevents (a) using a slot from a different zone whose priceAdjustment
    // was set for different conditions, and (b) cross-contaminating
    // delivery pricing with a stale pickup slot's priceAdjustment.
    if (selectedSlot) {
      if (
        selectedSlot.fulfillmentType !== "delivery" ||
        selectedSlot.zoneId !== matchedZone.id
      ) {
        logger.warn("Carrier service: delivery slot mismatch", {
          shopifyDomain,
          selectedSlotId: selectedSlot.id,
          selectedSlotFulfillmentType: selectedSlot.fulfillmentType,
          selectedSlotZoneId: selectedSlot.zoneId,
          matchedZoneId: matchedZone.id,
        });
        return json({ rates: [] });
      }
    }

    matchedZoneForLog = matchedZone;
    const baseCents = toCents(matchedZone.basePrice);
    const adjustmentCents = toCents(selectedSlot?.priceAdjustment);
    const totalCents = baseCents + adjustmentCents;

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
    if (err instanceof InvalidPriceError) {
      logger.error("Carrier service: invalid price input — gating checkout", err, {
        shopifyDomain,
        matchedZoneId: matchedZoneForLog?.id,
        selectedSlotId: selectedSlotForLog?.id,
        destinationPostcode: destinationPostcodeForLog,
      });
    } else {
      logger.error("Carrier service: uncaught throw — returning empty rates", err, {
        shopifyDomain,
      });
    }
    return json({ rates: [] });
  }
}
