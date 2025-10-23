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

Include pagination where appropriate and follow Shopify’s REST API conventions (e.g., using `limit` and `page_info` for lists).
