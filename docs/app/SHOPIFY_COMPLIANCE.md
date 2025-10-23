# SHOPIFY COMPLIANCE

To be approved in the Shopify App Store and achieve the **Built for Shopify** badge, your app must adhere to Shopify’s policies and technical standards. This document summarizes the key compliance areas to consider during development and review.

## App Store requirements
- **Web‑based app**: The app must run entirely in the cloud and leverage Shopify APIs. No downloadable desktop components or browser extensions.
- **Partner data and privacy**: Collect only the data you need. Provide a clear privacy policy, disclose data usage, and honor Shopify’s requirements for merchant and customer PII.
- **Performance**: Meet Shopify’s performance benchmarks on both the admin side and storefront. This includes Web Vitals thresholds for Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), and Interaction to Next Paint (INP).
- **User experience**: Follow Shopify Polaris design guidelines for admin screens and the checkout extension UI framework for storefront widgets. Handle errors gracefully and provide clear instructions.

## Built for Shopify targets
To earn the badge, you must meet specific technical achievements:
- **Admin Web Vitals**: LCP ≤ 2000 ms, CLS ≤ 0.1, INP ≤ 200 ms on the 75th percentile.
- **Shopify-provided components**: Use App Bridge, Checkout UI extensions, and theme app extensions appropriately. Avoid custom script tags when an extension point exists.
- **Merchant value & quality**: Provide unique utility that solves a meaningful problem for merchants. Ensure your billing model is transparent and uses Shopify Billing API.

## OAuth scopes and permissions
- Request the **minimum necessary scopes** (e.g., read_locations, write_order, etc.). Avoid broad scopes like `read_all_orders` unless absolutely necessary.
- After installation, exchange the temporary code for a permanent access token and store it securely. Rotate tokens if compromised.

## Uninstall cleanup
When a merchant uninstalls your app, automatically remove any:
- **Webhooks** and **script tags** you created.
- **Metafields** or **order attributes** that are no longer relevant.
- **Stored data** for that merchant (unless retention is required by law or merchant agreement).

## Privacy and PII handling
- Use encryption at rest and in transit for all personal data.
- Respect GDPR/CCPA requests to delete or export data.
- Log and monitor access to sensitive endpoints.

Adhering to these guidelines will help ensure your app passes Shopify’s review and offers a secure, high‑quality experience for merchants and customers.
