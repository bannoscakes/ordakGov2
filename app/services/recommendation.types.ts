/**
 * Recommendation Engine Types
 * Type definitions for the recommendation scoring system
 */

export interface RecommendationWeights {
  capacityWeight: number;        // 0.0 - 1.0
  distanceWeight: number;         // 0.0 - 1.0
  routeEfficiencyWeight: number;  // 0.0 - 1.0
  personalizationWeight: number;  // 0.0 - 1.0
}

export interface SlotRecommendationInput {
  slotId: string;
  date: Date;
  timeStart: string;
  timeEnd: string;
  capacity: number;
  booked: number;
  locationId: string;
  fulfillmentType: "delivery" | "pickup";
  location?: {
    latitude?: number;
    longitude?: number;
  };
}

export interface LocationRecommendationInput {
  locationId: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  totalCapacity: number;
  availableCapacity: number;
  supportsDelivery: boolean;
  supportsPickup: boolean;
}

export interface CustomerContext {
  customerId?: string;
  customerEmail?: string;
  deliveryAddress?: {
    latitude?: number;
    longitude?: number;
    postcode?: string;
  };
  preferences?: {
    preferredDays?: string[];
    preferredTimes?: string[];
    preferredLocationIds?: string[];
  };
}

export interface ScoringFactors {
  capacityScore: number;
  distanceScore: number;
  routeEfficiencyScore: number;
  personalizationScore: number;
}

export interface RecommendationResult {
  id: string;
  recommendationScore: number;
  factors: ScoringFactors;
  reason: string;
  recommended: boolean;
}

export interface SlotRecommendationResult extends RecommendationResult {
  slot: SlotRecommendationInput;
}

export interface LocationRecommendationResult extends RecommendationResult {
  location: LocationRecommendationInput;
  distanceKm?: number;
}

export interface OtherDelivery {
  latitude?: number;
  longitude?: number;
  scheduledDate: Date;
  timeStart: string;
}
