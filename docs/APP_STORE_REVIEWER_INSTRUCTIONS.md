# Ordak Go — App Reviewer Instructions

Paste-ready content for the Partners Dashboard "Reviewer instructions" field. Aim is to let a reviewer reproduce a full install → schedule → order → fulfill loop in under 10 minutes.

---

## Test environment

- **Demo store:** `ordakgo-v3.myshopify.com`
- **Storefront password (theme).** Provided to Shopify Reviewer separately. Default for our internal team: `theuld` — replace if rotated.
- **Admin login** for reviewer access: provided through the Partners "Submit for review" flow (Shopify creates a temporary collaborator account scoped to the dev store).
- **Carrier-Calculated Shipping (CCS)** is enabled on this dev store. CCS is required by Ordak Go's delivery rate flow. On a paid store this is included on Shopify Advanced, available as a $20/month add-on for Shopify plan, or free with annual billing or on dev stores. Reviewers do not need to flip this manually — it is already on for `ordakgo-v3`.

## Quick path (happy-case scenario)

The fastest end-to-end check (~5 minutes).

### 1. Install

1. From the Partners app listing → "Install on a development store" → choose `ordakgo-v3`.
2. Approve the OAuth scopes screen (the app requests `write_orders`, `read_locations`, `write_delivery_customizations`, `write_shipping`, `write_validations`).
3. The app loads at the embedded admin URL. The first page is the **Dashboard**.

### 2. Run the setup wizard

1. From the Dashboard → click **Setup wizard**.
2. Step 1 — store info: confirm the timezone (`Australia/Sydney`).
3. Step 2 — locations: ensure at least one location is active. The dev store has **Bannos HQ** and **Flour Lane HQ** seeded.
4. Step 3 — zones: at least one delivery zone. The dev store has **Sydney Metro** seeded with a base price of $10.
5. Step 4 — slot templates: confirm a delivery weekly template exists with at least one active slot.
6. Step 5 — pickup hours: confirm at least one pickup template exists for a pickup-capable location.
7. Step 6 — install the cart-block: open the theme editor link from the wizard. Verify the cart-block app embed is enabled.

The wizard also configures the AU shipping zone with the two flat rates Ordak Go's Delivery Customization Function expects (`Local Delivery` and `Pickup`). If the rates are missing, click **Set up AU shipping** on the wizard summary page.

### 3. Place a test order

1. Visit the storefront at `https://ordakgo-v3.myshopify.com` (password `theuld`).
2. Add any product to the cart.
3. Open the cart drawer — the Ordak Go scheduler renders inline. Choose **Delivery**, enter a Sydney postcode (e.g., `2000`), pick a date, and pick a time slot.
4. Click **Checkout**.
5. At checkout, observe that only the **Local Delivery** rate is offered (the Pickup rate is filtered out by the Delivery Customization Function — this is the cart-stage lock). Express checkout buttons are hidden by the Cart Validation Function (this is intentional — they would skip the cart and bypass scheduling).
6. Complete the order using Shopify's test card.

### 4. Verify the order

1. In Shopify admin → Orders → open the order you just placed.
2. Confirm the order has a tag in the format `ordak:slot-<id>` and an order metafield `ordak.slot_iso` with the chosen ISO datetime.
3. Open the Ordak Go admin → **Orders calendar**. The order appears on the chosen date, in the chosen slot.
4. Click the order to open the reschedule view. Pick a different slot and save. The order tag and metafield update; the customer's order page in Shopify admin reflects the new slot.

### 5. Pickup variant

Repeat steps 3–4 but choose **Pickup** instead of **Delivery**. Confirm that:

- The cart drawer shows the seeded pickup locations and pickup time windows.
- At checkout, the **Pickup** rate is the only rate offered (Local Delivery is filtered out).
- The order is recorded against the chosen pickup location, not a delivery zone.

## GDPR webhook check

Reviewers can verify GDPR webhooks fire by issuing the standard test webhooks from Partners Dashboard → App setup → Compliance webhooks → "Send test request":

- `customers/data_request` — Ordak Go logs receipt and surfaces the customer's stored data via `/app/data-requests` (a JSON export). Verify the row appears in that page.
- `customers/redact` — Ordak Go anonymises the customer's order links (sets email/phone/address to `null`) and deletes their `CustomerPreferences` and `RecommendationLog` rows.
- `shop/redact` — Ordak Go deletes all the shop's data (location, zone, rule, slot, order link, and shop records).

All three webhook handlers route through `authenticate.webhook(request)` for HMAC signature verification before any handler logic runs.

## Diagnostics surface

The app exposes a Diagnostics page (Dashboard → Tools → Diagnostics) that reports:

- Cart-block surface detection (cart drawer vs cart page; which surface the app embed is rendering on).
- Whether express-checkout buttons are currently visible on the storefront (an alert that the merchant must take action).
- Carrier Service registration state.
- Delivery Customization Function activation state (Plus-only feature; this will read "not active" on non-Plus dev stores — this is expected).
- Webhook subscription state.

Reviewers can use this surface to confirm the app is wired up end-to-end without having to inspect Partners Dashboard webhook configurations directly.

## Self-install convenience routes

If any `afterAuth` step is missed (it shouldn't be for a fresh install, but they exist as belt-and-braces for token-exchange refresh paths), reviewers can self-heal by visiting:

- `/app/install-carrier-service`
- `/app/install-delivery-customization`
- `/app/install-webhooks`
- `/app/setup-au-shipping`

Each route reports a one-line status and is safe to call repeatedly.

## Known platform constraint — Functions on custom apps

Shopify Functions (Delivery Customization, Cart Validation) on **custom-distributed** apps require the merchant to be on Shopify Plus. On a non-Plus dev store the activation step reports "Shop must be on Plus to activate functions from custom app" and the function does not run.

This constraint is removed when the app is distributed via the App Store — App Store apps can register functions on any plan. The dev store `ordakgo-v3` is Plus-eligible for testing, so reviewers will see functions active.

## Security posture

- All webhook payloads from Shopify are verified with HMAC-SHA256 before processing (`authenticate.webhook`).
- All storefront-facing endpoints (`/apps/proxy/*`) verify Shopify's app-proxy signature, then pin `shopDomain` from the verified session — the storefront cannot spoof which shop it acts as.
- Storefront endpoints are rate-limited per shop+IP (default 60 requests/minute, configurable via `RATE_LIMIT_MAX_PER_MINUTE`). Excess requests get HTTP 429 with `Retry-After`.
- OAuth tokens stored encrypted at rest by Supabase (Sydney region, `ap-southeast-2`).
- All traffic uses HTTPS (TLS 1.2 or higher).

## Note on `npm audit` findings

`npm audit` reports advisories chained through `@vercel/remix@2.16.7`'s strict peer dependency on `@remix-run/*@2.16.7`. The vulnerable code paths are not reachable in our runtime configuration:

- The critical `@remix-run/server-runtime` advisory targets `createFileSessionStorage`. We use `PrismaSessionStorage` from `@shopify/shopify-app-session-storage-prisma`. The vulnerable function is dead code in our deployment.
- The remaining advisories are in build-time tooling (`@remix-run/dev`, `esbuild`, `vite`, `@graphql-codegen/*`, `tar`, `valibot`) — not shipped to production runtime.

We will upgrade `@remix-run/*` to 2.17.x as soon as `@vercel/remix@2.17.x` is published. Tracking via `SHOPIFY_APP_STORE_CHECKLIST.md` § "npm audit findings (2026-05-09 — analyzed)".

## Contact

Questions or issues during review:

- **Email:** panos@bannos.com.au — monitored, response within 1 business day.
- **App support page:** in-app `/app/support` (link from the Dashboard).
- **Privacy policy:** https://ordak-go.vercel.app/policies/privacy
- **Terms of service:** https://ordak-go.vercel.app/policies/terms

Thank you for reviewing Ordak Go.
