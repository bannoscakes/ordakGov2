# CHECKOUT & STOREFRONT SPEC

## Surfaces
The app offers several surfaces across the storefront and checkout experience. Each surface must follow Shopify’s extension guidelines and leverage App Bridge where appropriate:

- **Product/Cart/Drawer app embed** – Renders the delivery/pickup toggle, postcode validator, and slot picker within product pages, cart pages, and mini-cart drawers. Uses Shopify App Bridge to communicate selections back to the cart and update order attributes.
- **Checkout UI Extension (Shopify Plus)** – Displays a summary of the selected delivery/pickup method, date, and time on the checkout page, allowing merchants on Plus to provide last‑minute confirmation and reduce abandoned checkouts. This extension should be optional and gracefully degrade on non‑Plus stores.

## Performance & UX guidelines
To qualify for Built for Shopify status and ensure a smooth customer experience, follow these performance best practices:

- **Lazy load the widget**: Only inject the scheduling widget when it becomes visible to the user (e.g., when the cart drawer opens). Target an initial JavaScript bundle size ≤ 35 KB gzipped.
- **Avoid blocking fonts and large assets**: Use system fonts or asynchronously loaded font files. Defer non‑critical CSS and JS.
- **Preconnect & prefetch**: Preconnect to your app’s API domain (e.g., `https://yourapp.example.com`) and prefetch slot availability data when the cart opens to reduce latency.
- **Responsive & accessible**: Ensure all controls are touch-friendly, support keyboard navigation, and have proper ARIA labels. Respect the shopper’s preferred language and locale.
- **Handle edge cases**: If no slots are available, provide clear messaging and fallback options (e.g., shipping). If network requests fail, show a non‑blocking error and allow the user to retry.

## Recommendation UI Integration

The storefront widget should prominently display recommended slots and locations to guide customers toward optimal choices while preserving flexibility.

### Slot Recommendations Display

- **Highlighted Recommendation**: When the widget loads and displays available time slots, the top‑recommended slot (highest `recommendation_score`) should be visually highlighted with a "Recommended" badge or label.
- **Pre‑selection**: Optionally pre‑select the recommended slot so the customer can proceed quickly, but allow them to easily change to any available slot.
- **Reasoning**: Show a brief explanation below the recommended slot (e.g., "Recommended for faster delivery" or "Most available capacity") to help customers understand the suggestion.
- **Visual Design**: Use a subtle accent color or icon (e.g., a star or checkmark) to distinguish recommended slots without overwhelming the interface.

### Location Recommendations Display

- When multiple pickup locations are available, sort them by `recommendation_score` with the top location marked as "Recommended" and the distance displayed (e.g., "2.3 km away").
- Include a small map preview or link to show the customer where each location is relative to their address.
- Allow the customer to override and select any location from the list.

### Alternative Time Recommendations

- If the customer's initially preferred slot (e.g., selected via date picker) is unavailable or full, display an inline message: "This time is fully booked. We recommend [alternative slot] instead."
- Show 2–3 nearby alternative slots with their recommendation scores and reasons.
- Let the customer easily switch between alternatives or choose a different day.

### Admin Configuration

- In the merchant admin panel, provide a **Recommendation Settings** page where merchants can:
  - Toggle recommendations on/off globally or per location.
  - Adjust weighting factors (e.g., prioritize capacity vs. route efficiency).
  - Set the number of alternative suggestions to show (default: 3).
  - View analytics on recommendation adoption rates (% of customers who selected recommended slots).

### Accessibility & Performance

- Ensure all recommendation labels are screen‑reader friendly with proper ARIA attributes (e.g., `aria-label="Recommended time slot"`).
- Lazy load recommendation data: fetch recommendations only when the slot picker is opened to minimize initial load time.
- Provide a fallback: if the recommendation API fails or times out, display slots in chronological order without blocking the user.

## Integration points
- **Attributes & metafields**: Write the selected method, date, time, and location to cart attributes or order metafields so they carry through to the order and admin. Include recommendation metadata (e.g., `recommendation_score`, `was_recommended: true`) for analytics.
- **Order tags**: Apply tags (e.g., `delivery-2025-10-23`, `pickup-location-123`, `recommended-slot`) to facilitate fulfillment filtering and track recommendation adoption.
- **ScriptTag cleanup**: Ensure any injected scripts are removed on uninstall to avoid leftover code.

These specifications will help the app blend seamlessly into merchants' storefronts while meeting performance and usability standards.
