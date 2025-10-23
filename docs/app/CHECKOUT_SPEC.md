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

## Integration points
- **Attributes & metafields**: Write the selected method, date, time, and location to cart attributes or order metafields so they carry through to the order and admin.
- **Order tags**: Apply tags (e.g., `delivery-2025-10-23`, `pickup-location-123`) to facilitate fulfillment filtering.
- **ScriptTag cleanup**: Ensure any injected scripts are removed on uninstall to avoid leftover code.

These specifications will help the app blend seamlessly into merchants’ storefronts while meeting performance and usability standards.
