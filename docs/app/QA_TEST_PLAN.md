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
- **Performance**: Measure LCP, CLS, and INP for the storefront widget on both desktop and mobile. Validate against Shopify's Web Vitals targets.
- **Rate limiting**: Simulate multiple staff members updating orders or schedules simultaneously to ensure API throttling does not break workflows.
- **Retry & idempotency**: Force webhook failures (e.g., by returning non‑2xx responses from the routing adapter) and confirm the app retries with idempotency keys.

## Recommendation Engine Tests

Test the recommendation system to ensure it provides accurate, helpful suggestions without degrading performance.

### Recommendation Accuracy
1. **Slot scoring**: Configure multiple slots with varying capacity levels. Verify that slots with higher remaining capacity receive higher recommendation scores.
2. **Distance-based location recommendations**: Test with addresses at different distances from pickup locations. Confirm that closer locations are ranked higher.
3. **Personalization**: For a returning customer with history (e.g., previously selected Saturday morning slots), verify that similar slots receive a boost in future recommendations.
4. **Popularity balancing**: Ensure popular slots are recommended only when capacity permits. Slots near full capacity should not be top recommendations.

### UI Display Tests
1. **"Recommended" badge**: Open the slot picker and verify the top‑recommended slot displays a "Recommended" badge or label.
2. **Reasoning text**: Confirm that a brief explanation (e.g., "Most available capacity") appears below recommended slots.
3. **Pre‑selection**: Check if the recommended slot is pre‑selected by default while still allowing the customer to change it.
4. **Alternative suggestions**: Select a fully booked slot and verify that 2–3 alternative slots are suggested with clear messaging.
5. **Location sorting**: When multiple pickup locations are available, ensure they are sorted by recommendation score with distance displayed.

### Event Tracking Tests
1. **recommendation.viewed event**: Open the slot picker and confirm a `recommendation.viewed` webhook is sent with the session ID and recommended slots.
2. **recommendation.selected event**: Select a recommended slot and verify the `recommendation.selected` webhook includes the slot ID, score, and `was_recommended: true`.
3. **Non‑recommended selection tracking**: Choose a non‑recommended slot and confirm the webhook correctly reflects `was_recommended: false`.

### Admin Configuration Tests
1. **Toggle recommendations**: In the admin panel, disable recommendations globally and verify that the storefront displays slots in chronological order without badges.
2. **Weight adjustment**: Adjust recommendation weights (e.g., prioritize route efficiency over capacity) and confirm slot rankings change accordingly.
3. **Adoption analytics**: Place test orders with both recommended and non‑recommended slots. Verify that adoption rates display correctly in the admin dashboard.

### Edge Cases & Fallbacks
1. **API timeout**: Simulate a slow or failed recommendation API response. Verify that the widget falls back to displaying slots in chronological order without blocking the user.
2. **No recommendations available**: Test scenarios where no slots qualify for recommendation (e.g., all slots nearly full). Ensure the widget still functions normally.
3. **New customer (no history)**: For first‑time customers with no preference data, confirm recommendations rely solely on capacity and distance scoring.

### Performance Impact
1. **Lazy loading**: Verify that recommendation data is fetched only when the slot picker is opened, not on initial page load.
2. **Response time**: Measure the time to fetch recommendations via POST /recommendations/slots. Target < 500 ms for 95th percentile.
3. **Widget load time**: Ensure adding recommendations does not increase the widget's JavaScript bundle size beyond the 35 KB gzipped target.

By running these tests regularly in your Test store, you can catch regressions early and maintain a high‑quality scheduling experience.
