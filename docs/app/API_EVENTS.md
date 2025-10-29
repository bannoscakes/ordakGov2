# API & EVENTS (Contracts)

## Outbound events (signed, idempotent)
- **order.scheduled**
- **order.schedule_updated**
- **order.schedule_canceled**

These events are emitted whenever a customer schedules, modifies, or cancels a delivery or pickup. They should be signed to verify authenticity and include idempotency keys to safely retry failed deliveries.

**Sample payload fields:**
- `shop_id`: The Shopify store ID.
- `order_id`: The associated order ID.
- `fulfillment_type`: `delivery` or `pickup`.
- `location_id`: Location (for pickup) or fulfilment location.
- `delivery_address`: Object containing customer address (for delivery) to aid routing.
- `scheduled_at`: ISO 8601 date/time of the selected slot.
- `slot_id`: Internal ID for the time slot.
- `meta`: Tags/metafields with custom fields (e.g., notes, rule IDs).

The receiving service (routing app or middleware) should respond with a 2xx status on success. Failed responses should trigger retry logic up to a configurable limit, using idempotency tokens to prevent duplicate side‑effects.

## Inbound Admin APIs
These are endpoints exposed by the app for merchant admin screens. They should be authenticated via OAuth tokens and used only in the app’s admin area.

- `POST /zones` – Create or update delivery/pickup zones (postcode ranges, lists, radius).
- `POST /rules` – Define rules such as cut‑off times, lead times, blackout dates, slot capacity.
- `POST /locations` – Add or manage pickup/delivery locations.
- `POST /simulate/eligibility` – Test postcode/zone eligibility and rule outcomes for a given address or product.

All endpoints return JSON responses. Success responses should include the created/updated resource. Error responses should follow this shape:

```json
{
  "code": "validation_error",
  "message": "Description of the error",
  "details": [
    { "field": "cutoff_time", "issue": "must be in HH:MM format" }
  ]
}
```

Include pagination where appropriate and follow Shopify's REST API conventions (e.g., using `limit` and `page_info` for lists).

## Recommendation APIs

These endpoints power the recommendation engine that suggests optimal slots, locations, and alternatives to customers.

### POST /recommendations/slots

Returns a ranked list of available delivery/pickup slots with recommendation scores and labels.

**Request:**
```json
{
  "postcode": "2000",
  "cart_items": ["product_id_1", "product_id_2"],
  "customer_id": "optional_customer_id",
  "fulfillment_type": "delivery" // or "pickup"
}
```

**Response:**
```json
{
  "slots": [
    {
      "slot_id": "slot_123",
      "date": "2025-10-28",
      "time_start": "09:00",
      "time_end": "11:00",
      "recommendation_score": 0.95,
      "recommended": true,
      "reason": "Most available capacity",
      "capacity_remaining": 8,
      "location_id": "loc_456"
    },
    {
      "slot_id": "slot_124",
      "date": "2025-10-28",
      "time_start": "14:00",
      "time_end": "16:00",
      "recommendation_score": 0.72,
      "recommended": false,
      "capacity_remaining": 3,
      "location_id": "loc_456"
    }
  ]
}
```

### POST /recommendations/locations

Returns nearby pickup locations ranked by proximity and capacity.

**Request:**
```json
{
  "postcode": "2000",
  "address": "123 Main St, Sydney NSW",
  "customer_id": "optional_customer_id"
}
```

**Response:**
```json
{
  "locations": [
    {
      "location_id": "loc_456",
      "name": "Sydney Warehouse",
      "address": "45 Industrial Rd, Sydney",
      "distance_km": 2.3,
      "recommendation_score": 0.88,
      "recommended": true,
      "reason": "Closest location with availability"
    },
    {
      "location_id": "loc_789",
      "name": "Bondi Pickup Counter",
      "address": "78 Beach Rd, Bondi",
      "distance_km": 5.1,
      "recommendation_score": 0.65,
      "recommended": false
    }
  ]
}
```

## Recommendation Events

These events track customer interactions with recommendations for analytics and optimization.

### recommendation.viewed

Emitted when a customer views recommended slots or locations in the widget.

**Payload:**
```json
{
  "event": "recommendation.viewed",
  "timestamp": "2025-10-27T14:32:00Z",
  "session_id": "sess_abc123",
  "customer_id": "customer_xyz",
  "shop_id": "shop_123",
  "recommendations": [
    {
      "type": "slot",
      "slot_id": "slot_123",
      "recommendation_score": 0.95
    }
  ]
}
```

### recommendation.selected

Emitted when a customer selects a recommended slot or location.

**Payload:**
```json
{
  "event": "recommendation.selected",
  "timestamp": "2025-10-27T14:35:00Z",
  "session_id": "sess_abc123",
  "customer_id": "customer_xyz",
  "shop_id": "shop_123",
  "selected": {
    "type": "slot",
    "slot_id": "slot_123",
    "recommendation_score": 0.95,
    "was_recommended": true
  },
  "alternatives_shown": ["slot_124", "slot_125"]
}
```

These events should be sent to the merchant's analytics platform and can be used to train machine learning models for improved recommendations over time.
