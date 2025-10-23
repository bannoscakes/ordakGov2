# QA TEST PLAN (Real Test Store Only)

This plan outlines the scenarios and edge cases to verify using your **Test Shopify store**. Because the app does not use mock data or staging, all tests must run against real orders created by staff accounts.

## Test matrices
To ensure comprehensive coverage, test combinations of the following factors:

- **Timezones**: Verify slot calculations across the merchant’s timezone and shopper timezones (if different). Ensure daylight saving transitions are handled correctly.
- **Cut‑off times & lead times**: Create orders before and after cut‑off times, and with varying lead times (same‑day, next‑day, etc.).
- **Capacity limits**: Set slot capacity to 1 or 2 and attempt to book multiple orders in the same slot to confirm caps are enforced.

## Eligibility edge cases
- **Postcode ranges**: Test addresses on the boundary of allowed ranges (e.g., lowest and highest postcode in a zone).
- **Excluded postcodes**: Add an excluded postcode within an allowed range and verify it is blocked.
- **Multiple zones**: When two zones overlap, confirm the correct rule (e.g., delivery vs pickup) applies based on priority.

## End‑to‑end scenarios
1. **Eligible delivery order**: Place an order with a valid delivery postcode, select a slot, complete checkout, and verify order metafields/tags.
2. **Ineligible address**: Attempt to schedule with an out‑of‑range postcode; confirm the widget blocks progression and shows a clear message.
3. **Pickup order**: Choose pickup, select location and time, complete checkout, and verify order attributes.
4. **Reschedule**: If rescheduling is enabled, change the slot/date after placing an order; ensure events are emitted and old slots freed.
5. **Cancel**: Cancel an order; verify the cancellation webhook triggers and slots become available again.

## Non‑functional tests
- **Performance**: Measure LCP, CLS, and INP for the storefront widget on both desktop and mobile. Validate against Shopify’s Web Vitals targets.
- **Rate limiting**: Simulate multiple staff members updating orders or schedules simultaneously to ensure API throttling does not break workflows.
- **Retry & idempotency**: Force webhook failures (e.g., by returning non‑2xx responses from the routing adapter) and confirm the app retries with idempotency keys.

By running these tests regularly in your Test store, you can catch regressions early and maintain a high‑quality scheduling experience.
