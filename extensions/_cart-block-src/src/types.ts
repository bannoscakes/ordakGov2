export type Fulfillment = "delivery" | "pickup";

export interface BlockConfig {
  surface: "cart-page" | "cart-drawer";
  blockId: string;
  shopDomain: string;
  currency: string | null;
  locale: string | null;
  customerId: string | null;
  customerEmail: string | null;
  headingText: string;
  defaultFulfillment: Fulfillment;
  showPostcodeField: boolean;
  autoSelectRecommended: boolean;
  // Pickup-mode banner shown in place of the time-slot grid. Configurable
  // by the merchant in the theme editor; we never gate the storefront copy
  // on developer-set defaults. See memory/no_hardcoded_strings.md.
  pickupInstructions: string;
  daysAvailableHint: string;
  proxyBase: string;
}

export interface EligibilityLocation {
  id: string;
  name: string;
  address: string;
  city: string | null;
  supportsDelivery: boolean;
  supportsPickup: boolean;
  distance: number | null;
}

export interface EligibilityResponse {
  eligible: boolean;
  locations: EligibilityLocation[];
  services: { delivery: boolean; pickup: boolean };
  // Matched delivery zone with its basePrice. Null for pickup or no match.
  matchedZone?: { id: string; name: string; basePrice: string } | null;
  message?: string;
}

export interface Slot {
  slotId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  recommendationScore: number;
  recommended: boolean;
  reason: string;
  capacityRemaining: number;
  capacity: number;
  // Per-slot premium added to the zone base price. Prisma serializes
  // Decimal as a string (e.g. "10.00").
  priceAdjustment: string;
  locationId: string;
  // Delivery slots carry the zone id so the cart-block can pass it to the
  // Carrier Service callback via `_zone_id` line item property — without
  // this, the callback falls back to a postcode rescan that may pick a
  // different (overlapping) zone, leaking the wrong basePrice and dropping
  // the slot's priceAdjustment. Pickup slots have no zone (null).
  zoneId: string | null;
  fulfillmentType: Fulfillment;
}

export interface SlotResponse {
  slots: Slot[];
  meta: {
    totalSlots: number;
    recommendedCount: number;
    dateRange: { start: string; end: string };
    // Optional — older API builds don't include it. Cart-block falls back to
    // post-D5 defaults (no RECOMMENDED badge, show capacity reason).
    widgetAppearance?: {
      showRecommendedBadge: boolean;
      showMostAvailableBadge: boolean;
    };
  };
}

export interface RecommendedLocation {
  locationId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  recommendationScore: number;
  recommended: boolean;
  reason: string;
  distanceKm?: number;
  availableCapacity: number;
  totalCapacity: number;
  supportsDelivery: boolean;
  supportsPickup: boolean;
}

export interface LocationResponse {
  locations: RecommendedLocation[];
  meta: {
    totalLocations: number;
    recommendedCount: number;
    hasCoordinates: boolean;
  };
}
