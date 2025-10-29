/**
 * Recommendation Service
 * Core logic for calculating recommendation scores for slots and locations
 */

import {
  calculateDistance,
  calculateDistanceScore,
  calculateAverageDistance,
  type Coordinates,
} from "./distance.service";
import type {
  RecommendationWeights,
  SlotRecommendationInput,
  LocationRecommendationInput,
  CustomerContext,
  ScoringFactors,
  SlotRecommendationResult,
  LocationRecommendationResult,
  OtherDelivery,
} from "./recommendation.types";

/**
 * Calculate recommendation score for time slots
 */
export function scoreSlots(
  slots: SlotRecommendationInput[],
  weights: RecommendationWeights,
  customerContext?: CustomerContext,
  otherDeliveries?: OtherDelivery[]
): SlotRecommendationResult[] {
  if (slots.length === 0) return [];

  const results: SlotRecommendationResult[] = slots.map((slot) => {
    const factors = calculateSlotScoringFactors(
      slot,
      weights,
      customerContext,
      otherDeliveries
    );

    const recommendationScore = calculateWeightedScore(factors, weights);
    const reason = generateSlotRecommendationReason(factors, weights);

    return {
      id: slot.slotId,
      slot,
      recommendationScore,
      factors,
      reason,
      recommended: false, // Will be set later based on ranking
    };
  });

  // Sort by score (highest first)
  results.sort((a, b) => b.recommendationScore - a.recommendationScore);

  // Mark top 3 as recommended
  results.forEach((result, index) => {
    result.recommended = index < 3;
  });

  return results;
}

/**
 * Calculate recommendation score for pickup locations
 */
export function scoreLocations(
  locations: LocationRecommendationInput[],
  weights: RecommendationWeights,
  customerContext?: CustomerContext
): LocationRecommendationResult[] {
  if (locations.length === 0) return [];

  const results: LocationRecommendationResult[] = locations.map((location) => {
    const factors = calculateLocationScoringFactors(
      location,
      weights,
      customerContext
    );

    const recommendationScore = calculateWeightedScore(factors, weights);
    const reason = generateLocationRecommendationReason(factors, weights);

    let distanceKm: number | undefined;
    if (
      location.latitude &&
      location.longitude &&
      customerContext?.deliveryAddress?.latitude &&
      customerContext?.deliveryAddress?.longitude
    ) {
      distanceKm = calculateDistance(
        { latitude: location.latitude, longitude: location.longitude },
        {
          latitude: customerContext.deliveryAddress.latitude,
          longitude: customerContext.deliveryAddress.longitude,
        }
      );
    }

    return {
      id: location.locationId,
      location,
      recommendationScore,
      factors,
      reason,
      recommended: false,
      distanceKm,
    };
  });

  // Sort by score (highest first)
  results.sort((a, b) => b.recommendationScore - a.recommendationScore);

  // Mark top recommendation
  if (results.length > 0) {
    results[0].recommended = true;
  }

  return results;
}

/**
 * Calculate individual scoring factors for a slot
 */
function calculateSlotScoringFactors(
  slot: SlotRecommendationInput,
  weights: RecommendationWeights,
  customerContext?: CustomerContext,
  otherDeliveries?: OtherDelivery[]
): ScoringFactors {
  // 1. Capacity Score: Higher score for more available capacity
  const capacityScore = calculateCapacityScore(slot.capacity, slot.booked);

  // 2. Distance Score: Only relevant if we have coordinates
  let distanceScore = 0.5; // Neutral if no data
  if (
    slot.fulfillmentType === "pickup" &&
    slot.location?.latitude &&
    slot.location?.longitude &&
    customerContext?.deliveryAddress?.latitude &&
    customerContext?.deliveryAddress?.longitude
  ) {
    const distance = calculateDistance(
      { latitude: slot.location.latitude, longitude: slot.location.longitude },
      {
        latitude: customerContext.deliveryAddress.latitude,
        longitude: customerContext.deliveryAddress.longitude,
      }
    );
    distanceScore = calculateDistanceScore(distance);
  }

  // 3. Route Efficiency Score: How close is this slot to other deliveries?
  let routeEfficiencyScore = 0.5; // Neutral if no data
  if (
    slot.fulfillmentType === "delivery" &&
    slot.location?.latitude &&
    slot.location?.longitude &&
    otherDeliveries &&
    otherDeliveries.length > 0
  ) {
    routeEfficiencyScore = calculateRouteEfficiencyScore(
      { latitude: slot.location.latitude, longitude: slot.location.longitude },
      otherDeliveries,
      slot.date,
      slot.timeStart
    );
  }

  // 4. Personalization Score: Does this match customer preferences?
  let personalizationScore = 0.5; // Neutral if no data
  if (customerContext?.preferences) {
    personalizationScore = calculatePersonalizationScore(
      slot,
      customerContext.preferences
    );
  }

  return {
    capacityScore,
    distanceScore,
    routeEfficiencyScore,
    personalizationScore,
  };
}

/**
 * Calculate individual scoring factors for a location
 */
function calculateLocationScoringFactors(
  location: LocationRecommendationInput,
  weights: RecommendationWeights,
  customerContext?: CustomerContext
): ScoringFactors {
  // 1. Capacity Score
  const capacityScore = calculateCapacityScore(
    location.totalCapacity,
    location.totalCapacity - location.availableCapacity
  );

  // 2. Distance Score
  let distanceScore = 0.5;
  if (
    location.latitude &&
    location.longitude &&
    customerContext?.deliveryAddress?.latitude &&
    customerContext?.deliveryAddress?.longitude
  ) {
    const distance = calculateDistance(
      { latitude: location.latitude, longitude: location.longitude },
      {
        latitude: customerContext.deliveryAddress.latitude,
        longitude: customerContext.deliveryAddress.longitude,
      }
    );
    distanceScore = calculateDistanceScore(distance);
  }

  // 3. Route Efficiency: Not applicable for location selection
  const routeEfficiencyScore = 0.5;

  // 4. Personalization: Has customer used this location before?
  let personalizationScore = 0.5;
  if (customerContext?.preferences?.preferredLocationIds) {
    personalizationScore = customerContext.preferences.preferredLocationIds.includes(
      location.locationId
    )
      ? 1.0
      : 0.3;
  }

  return {
    capacityScore,
    distanceScore,
    routeEfficiencyScore,
    personalizationScore,
  };
}

/**
 * Calculate capacity score (0.0 - 1.0)
 * Higher remaining capacity = higher score
 */
function calculateCapacityScore(capacity: number, booked: number): number {
  if (capacity <= 0) return 0;

  const remaining = capacity - booked;
  if (remaining <= 0) return 0;

  // Use a non-linear curve: slots near capacity get lower scores
  const utilizationRate = booked / capacity;
  if (utilizationRate >= 0.9) return 0.2; // Nearly full
  if (utilizationRate >= 0.7) return 0.5; // Moderately full
  if (utilizationRate >= 0.5) return 0.8; // Half full

  return 1.0; // Plenty of capacity
}

/**
 * Calculate route efficiency score
 * Higher score if this delivery is close to other scheduled deliveries in the same time window
 */
function calculateRouteEfficiencyScore(
  slotLocation: Coordinates,
  otherDeliveries: OtherDelivery[],
  slotDate: Date,
  slotTime: string
): number {
  // Filter to deliveries on the same day and similar time
  const relevantDeliveries = otherDeliveries.filter((delivery) => {
    const isSameDay =
      delivery.scheduledDate.toDateString() === slotDate.toDateString();
    const isSimilarTime =
      Math.abs(
        parseTime(delivery.timeStart) - parseTime(slotTime)
      ) <= 2 * 60; // Within 2 hours
    return (
      isSameDay &&
      isSimilarTime &&
      delivery.latitude !== undefined &&
      delivery.longitude !== undefined
    );
  });

  if (relevantDeliveries.length === 0) return 0.5; // Neutral

  // Calculate average distance to other deliveries
  const otherCoordinates: Coordinates[] = relevantDeliveries
    .filter((d) => d.latitude !== undefined && d.longitude !== undefined)
    .map((d) => ({ latitude: d.latitude!, longitude: d.longitude! }));

  const avgDistance = calculateAverageDistance(slotLocation, otherCoordinates);

  // Closer to other deliveries = higher score (better route efficiency)
  return calculateDistanceScore(avgDistance, 20); // 20km max for clustering
}

/**
 * Calculate personalization score based on customer preferences
 */
function calculatePersonalizationScore(
  slot: SlotRecommendationInput,
  preferences: NonNullable<CustomerContext["preferences"]>
): number {
  let score = 0.5; // Start neutral

  // Check if day matches preferred days
  if (preferences.preferredDays && preferences.preferredDays.length > 0) {
    const dayName = slot.date.toLocaleDateString("en-US", { weekday: "long" });
    if (preferences.preferredDays.includes(dayName)) {
      score += 0.3;
    }
  }

  // Check if time matches preferred times
  if (preferences.preferredTimes && preferences.preferredTimes.length > 0) {
    const matchesTime = preferences.preferredTimes.some((preferredTime) => {
      return preferredTime.includes(slot.timeStart);
    });
    if (matchesTime) {
      score += 0.2;
    }
  }

  return Math.min(1.0, score);
}

/**
 * Calculate weighted score from individual factors
 */
function calculateWeightedScore(
  factors: ScoringFactors,
  weights: RecommendationWeights
): number {
  const totalWeight =
    weights.capacityWeight +
    weights.distanceWeight +
    weights.routeEfficiencyWeight +
    weights.personalizationWeight;

  if (totalWeight === 0) return 0.5; // Neutral if no weights

  const weightedSum =
    factors.capacityScore * weights.capacityWeight +
    factors.distanceScore * weights.distanceWeight +
    factors.routeEfficiencyScore * weights.routeEfficiencyWeight +
    factors.personalizationScore * weights.personalizationWeight;

  return Math.round((weightedSum / totalWeight) * 100) / 100; // Round to 2 decimals
}

/**
 * Generate human-readable reason for slot recommendation
 */
function generateSlotRecommendationReason(
  factors: ScoringFactors,
  weights: RecommendationWeights
): string {
  // Find the dominant factor
  const factorScores = [
    { factor: "capacity", score: factors.capacityScore, weight: weights.capacityWeight },
    { factor: "distance", score: factors.distanceScore, weight: weights.distanceWeight },
    { factor: "route", score: factors.routeEfficiencyScore, weight: weights.routeEfficiencyWeight },
    { factor: "preference", score: factors.personalizationScore, weight: weights.personalizationWeight },
  ];

  // Weight the factors and find the highest
  const weightedFactors = factorScores.map((f) => ({
    ...f,
    weightedScore: f.score * f.weight,
  }));
  weightedFactors.sort((a, b) => b.weightedScore - a.weightedScore);

  const topFactor = weightedFactors[0];

  switch (topFactor.factor) {
    case "capacity":
      return "Most available capacity";
    case "distance":
      return "Closest location";
    case "route":
      return "Efficient delivery route";
    case "preference":
      return "Matches your preferences";
    default:
      return "Recommended option";
  }
}

/**
 * Generate human-readable reason for location recommendation
 */
function generateLocationRecommendationReason(
  factors: ScoringFactors,
  weights: RecommendationWeights
): string {
  if (factors.distanceScore > 0.7 && weights.distanceWeight > 0.3) {
    return "Closest location with availability";
  }
  if (factors.capacityScore > 0.8) {
    return "High availability";
  }
  if (factors.personalizationScore > 0.8) {
    return "Your preferred location";
  }
  return "Recommended location";
}

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
function parseTime(timeString: string): number {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}
