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
 * How we know which fulfillment the customer picked: cart attributes are
 * NOT included in the carrier service rate request. The cart-block mirrors
 * its selections onto every line item as `_`-prefixed properties (e.g.
 * `_delivery_method`, `_slot_id`, `_location_id`). Those DO appear at
 * `rate.items[*].properties` and are the contract this callback reads.
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
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
  total_price: string; // cents as string, e.g. "1000"
  description: string;
  currency: string;
  min_delivery_date?: string;
  max_delivery_date?: string;
}

const DEFAULT_DELIVERY_PRICE_CENTS = 1000; // AUD 10.00 placeholder until per-zone pricing lands

function normalizePostcode(postcode: string | undefined): string {
  return (postcode ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function postcodeMatchesZone(
  postcode: string,
  zone: { type: string; postcodes: string[] },
): boolean {
  const target = normalizePostcode(postcode);
  if (!target) return false;

  if (zone.type === "postcode_list") {
    return zone.postcodes.some((p) => normalizePostcode(p) === target);
  }
  // postcode_range / radius are not implemented at this layer yet — return
  // false so callers fall through to "no rates" rather than spuriously match.
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

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const shopifyDomain = request.headers.get("x-shopify-shop-domain");
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
    include: { locations: true, zones: true },
  });
  if (!shop) {
    logger.warn("Carrier service: unknown shop", { shopifyDomain });
    return json({ rates: [] });
  }

  const deliveryMethod = readLineItemProperty(rate.items, "_delivery_method");
  const requestedLocationId = readLineItemProperty(rate.items, "_location_id");
  const requestedSlotId = readLineItemProperty(rate.items, "_slot_id");

  // Pickup branch: customer picked pickup at a specific location in the cart.
  // Return a single $0 rate for that location only — no delivery options.
  if (deliveryMethod === "pickup") {
    const pickupLocation = shop.locations.find(
      (l) =>
        (requestedLocationId ? l.id === requestedLocationId : l.supportsPickup) &&
        l.isActive &&
        l.supportsPickup,
    );

    if (!pickupLocation) {
      logger.info("Carrier service: pickup requested but no eligible location", {
        shopifyDomain,
        requestedLocationId,
      });
      return json({ rates: [] });
    }

    const rates: RateResponse[] = [
      {
        service_name: `Pickup at ${pickupLocation.name}`,
        service_code: `ORDAK_PICKUP_${pickupLocation.id}`,
        total_price: "0",
        description: `Pick up your order from ${pickupLocation.name}`,
        currency: rate.currency,
      },
    ];
    return json({ rates });
  }

  // Delivery branch (default when delivery_method is "delivery" or absent):
  // match the destination postcode against active zones and return a rate
  // per matching zone's location.
  const destinationPostcode = rate.destination.postal_code;
  const matchingZones = shop.zones.filter(
    (z) => z.isActive && postcodeMatchesZone(destinationPostcode ?? "", z),
  );

  if (matchingZones.length === 0) {
    return json({ rates: [] });
  }

  const ratesByLocation = new Map<string, RateResponse>();
  for (const zone of matchingZones) {
    const location = shop.locations.find(
      (l) => l.id === zone.locationId && l.isActive && l.supportsDelivery,
    );
    if (!location) continue;
    if (ratesByLocation.has(location.id)) continue;

    ratesByLocation.set(location.id, {
      service_name: `Delivery from ${location.name}`,
      service_code: `ORDAK_DELIVERY_${location.id}`,
      total_price: String(DEFAULT_DELIVERY_PRICE_CENTS),
      description: requestedSlotId
        ? `Scheduled delivery (slot ${requestedSlotId})`
        : "Scheduled delivery",
      currency: rate.currency,
    });
  }

  return json({ rates: Array.from(ratesByLocation.values()) });
}
