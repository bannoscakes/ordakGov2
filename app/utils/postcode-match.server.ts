/**
 * Postcode → Zone matching used by the carrier-service rate callback, the
 * storefront slot recommendations endpoint, and the eligibility check.
 *
 * All three call sites must agree (a customer who passes the eligibility
 * check expects to see slots and to get a rate at checkout). Single source
 * of truth lives here so future changes don't drift between routes.
 */

import type { Zone } from "@prisma/client";

export type ZoneMatchInput = Pick<Zone, "type" | "postcodes" | "excludePostcodes">;

export function normalizePostcode(postcode: string | null | undefined): string {
  return (postcode ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Returns true if the destination postcode falls inside the zone, after
 * applying the zone's exclude list. Fails closed for `radius` zones — those
 * need destination geocoding which Shopify doesn't supply.
 */
export function postcodeMatchesZone(postcode: string, zone: ZoneMatchInput): boolean {
  const target = normalizePostcode(postcode);
  if (!target) return false;

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
  return false;
}
