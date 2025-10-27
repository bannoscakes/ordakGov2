# DATA MODEL (Conceptual)

Entities:
- Shop, Location, Zone, Rule (cutoff, lead/blackout), SlotTemplate, Schedule, OrderLink, EventLog
- **Recommendation-related**: CustomerPreferences, RecommendationLog, Slot (extended with recommendation_score)

## Core Entities

### Shop
- Merchant's Shopify store configuration
- Links to multiple locations
- Global settings for recommendation engine (weights, scoring factors)

### Location
- Physical location for pickup or delivery fulfillment
- Includes coordinates (latitude, longitude) for distance calculations
- Supports multiple zones

### Zone
- Defines delivery/pickup coverage areas (postcode ranges, lists, radius)
- Links to locations
- Used for eligibility validation

### Rule
- Defines scheduling constraints (cut-off times, lead times, blackout dates)
- Slot capacity limits
- Applied per location or zone

### SlotTemplate
- Defines recurring time slot patterns (e.g., "Monday 9-11am")
- Duration and capacity defaults

### Schedule
- Generated slots for specific dates based on templates and rules
- Extended with `recommendation_score` field (0.0-1.0) for ranking
- Tracks remaining capacity

### OrderLink
- Links orders to scheduled slots
- Stores selected recommendation metadata

### EventLog
- Audit trail for order events (scheduled, updated, canceled)
- Includes recommendation tracking events

## Recommendation Entities

### CustomerPreferences
- Stores customer's historical slot selections
- Preferred days, times, locations
- Used for personalization algorithms
- Optional: linked to Shopify customer ID or email hash

### RecommendationLog
- Audit log for recommendation views and selections
- Fields: session_id, customer_id, recommended_slots[], selected_slot, timestamp
- Used for analytics and ML model training

Notes:
- No seed data; all entities created by merchant in Admin.
- Timezone-aware slot generation.
- Recommendation data is optional and can be disabled per merchant.
