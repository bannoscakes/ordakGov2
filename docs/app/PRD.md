# PRD — Delivery & Pickup Scheduler (Shopify + SaaS)

## Goals
- Let shoppers choose Delivery or Pickup easily
- Validate postcode eligibility
- Let shoppers pick date/time within merchant rules
- Hand off scheduled deliveries to external routing

## Non-Goals (MVP)
- No inventory management, no payment changes

## Users
- Shopper, Merchant Admin, Dispatcher (routing)

## Success Metrics
- % orders with valid scheduled slot
- Reduction in support tickets (“can you deliver X day?”)
- Slot overbooking rate = 0

## Scope (MVP)
- Storefront widget: method toggle, postcode check, calendar & slot picker
- Admin: locations, zones/postcodes, rules (cut-off, lead time, blackout), slot caps
- Events: schedule/update/cancel → routing adapter
