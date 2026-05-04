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
  // Per-slot price premium added to the zone base price (e.g. "10.00" = +$10).
  // Decimal serialized as a string by Prisma — render as a number when displaying.
  priceAdjustment: string;
  locationId: string;
  fulfillmentType: Fulfillment;
}

export interface SlotResponse {
  slots: Slot[];
  meta: {
    totalSlots: number;
    recommendedCount: number;
    dateRange: { start: string; end: string };
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
