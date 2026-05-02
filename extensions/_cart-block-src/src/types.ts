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
