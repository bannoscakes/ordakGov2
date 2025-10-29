# Recommendation Engine Services

This directory contains the core recommendation scoring algorithm for the ordakGov2 delivery and pickup scheduler.

## Overview

The recommendation engine helps customers choose optimal delivery/pickup slots and locations by scoring options based on multiple factors.

## Files

### `recommendation.service.ts`
Main service containing the scoring logic for slots and locations.

**Key Functions:**
- `scoreSlots()` - Scores and ranks time slots
- `scoreLocations()` - Scores and ranks pickup locations

### `recommendation.types.ts`
TypeScript type definitions for the recommendation system.

### `distance.service.ts`
Distance calculation utilities using the Haversine formula for geographic coordinates.

## How the Algorithm Works

### Scoring Factors

The recommendation score (0.0 - 1.0) is calculated using four weighted factors:

#### 1. **Capacity Score** (default weight: 0.4)
- Higher score for slots with more available capacity
- Penalizes nearly-full slots (>90% utilization)
- Ensures customers aren't recommended slots likely to fill up

**Formula:**
```
if utilization >= 90%: score = 0.2
if utilization >= 70%: score = 0.5
if utilization >= 50%: score = 0.8
else: score = 1.0
```

#### 2. **Distance Score** (default weight: 0.3)
- For pickup locations: closer to customer = higher score
- Uses Haversine formula to calculate real geographic distance
- Linear decay from 1.0 (0km) to 0.0 (50km+)

**Formula:**
```
score = 1.0 - (distance_km / max_distance)
```

#### 3. **Route Efficiency Score** (default weight: 0.2)
- For delivery slots: prioritizes slots that cluster deliveries geographically
- Considers other deliveries scheduled in the same time window
- Reduces driver travel time and improves logistics

**Logic:**
- Finds deliveries on the same day within ±2 hours
- Calculates average distance to those deliveries
- Closer clustering = higher score

#### 4. **Personalization Score** (default weight: 0.1)
- Matches customer's historical preferences
- Considers preferred days (e.g., always orders on Saturday)
- Considers preferred times (e.g., prefers morning slots)
- Considers preferred locations

**Scoring:**
- Matches preferred day: +0.3
- Matches preferred time: +0.2
- Previously used location: 1.0 vs 0.3

### Weighted Combination

The final recommendation score is:

```typescript
score = (
  capacityScore * capacityWeight +
  distanceScore * distanceWeight +
  routeEfficiencyScore * routeEfficiencyWeight +
  personalizationScore * personalizationWeight
) / totalWeight
```

Default weights:
- Capacity: 0.4 (40%)
- Distance: 0.3 (30%)
- Route Efficiency: 0.2 (20%)
- Personalization: 0.1 (10%)

Merchants can adjust these weights in their shop settings.

### Ranking & Recommendations

After scoring:
1. Results are sorted by score (highest first)
2. Top 3 slots are marked as "recommended"
3. Top 1 location is marked as "recommended"
4. Each result includes a human-readable reason (e.g., "Most available capacity")

## Usage Example

```typescript
import { scoreSlots, scoreLocations } from "~/services";

// Score slots
const results = scoreSlots(
  slots, // Array of slot data
  {
    capacityWeight: 0.4,
    distanceWeight: 0.3,
    routeEfficiencyWeight: 0.2,
    personalizationWeight: 0.1,
  },
  {
    // Customer context (optional)
    customerId: "customer_123",
    deliveryAddress: {
      latitude: -33.8688,
      longitude: 151.2093,
    },
    preferences: {
      preferredDays: ["Saturday"],
      preferredTimes: ["09:00-11:00"],
    },
  },
  otherDeliveries // Other scheduled deliveries for route efficiency
);

// Results are sorted and marked with recommendations
results.forEach((result) => {
  console.log(
    `Slot ${result.id}: Score ${result.recommendationScore}, ${result.reason}`
  );
  if (result.recommended) {
    console.log("  ⭐ Recommended");
  }
});
```

## Configuration

Merchants can configure weights via the Shop model in the database:

```prisma
model Shop {
  recommendationsEnabled Boolean @default(true)
  capacityWeight        Float   @default(0.4)
  distanceWeight        Float   @default(0.3)
  routeEfficiencyWeight Float   @default(0.2)
  personalizationWeight Float   @default(0.1)
}
```

## Future Enhancements

Potential improvements:
- Machine learning models to predict slot popularity
- Dynamic pricing/demand shaping for off-peak slots
- Weather and traffic data integration
- Real-time capacity updates
- A/B testing different weight configurations
