# PLAN — what's next for Ordak Go

Last updated: 2026-05-07 (late session) — Phase 1 verification gate CLOSED with real test orders #1001 (delivery) + #1002 (pickup) on `ordakgo-v3`. Per-location pickup hours admin shipped in PR #95 (closes the slot-management gap the original Phase D missed — pickup is per-Location, not per-Zone). `ordak-go-38` released globally with the pickup-mode wording fix. Next gate is App Store listing assets (Phase 2 in `memory/next_steps_plan.md`).

## Where we are

✅ **Foundation done:**
- Stack upgraded to current Shopify SDKs (Polaris 13, app-remix 4.2, shopify-api 13, Prisma 6.19, Vite 5)
- Linked to Partners app **Ordak Go** under **P&T Group** org
- Supabase project provisioned, schema migrated
- Dev store `ordakgo-v3.myshopify.com` created
- App installs on dev store via token-exchange auth, embedded admin renders, webhooks fire, DB writes confirmed
- 0 TypeScript errors, production build passes

✅ **Phase A · Cart app block (theme app extension) — merged 2026-05-02 (PR #39):**
- `extensions/cart-block/` — Preact theme app extension, gzipped bundle 13.45KB (under the 35KB budget). Source split into `extensions/_cart-block-src/` so Shopify CLI's strict "only assets/blocks/locales/snippets" enforcement passes.
- 5 storefront proxy routes (`apps.proxy.eligibility.check`, `recommendations.{locations,slots}`, `events.recommendation-{viewed,selected}`) all wired through `app/utils/app-proxy.server.ts` `appProxyAction()` helper that authenticates and pins `shopDomain`/`shopifyDomain` from session.
- One-command dev loop: `npm run dev:up` / `dev:down` / `dev:logs`. Stable named cloudflared tunnel `ordak-go-dev` permanently routed via Cloudflare DNS to `https://dev.ordak.vip`.
- afterAuth `prisma.shop.upsert` so api.* handlers find a Shop row on fresh installs.
- 6 admin form routes (locations.new/$id, zones.new/$id, rules.new/$id) switched from raw `<form method="post">` to Remix's `<Form>`.

✅ **Phase B · Carrier Service (the rate gate) — merged 2026-05-02 (PR #40):**
- `Shop.carrierServiceId` column + migration `20260502075923_add_carrier_service_id`.
- `app/services/carrier-service.server.ts` — register/unregister via Admin GraphQL `carrierServiceCreate` / `carrierServiceDelete`.
- `app/routes/api.carrier-service.rates.tsx` — POST callback that branches on `_delivery_method` line item property (pickup → \$0 single rate, delivery → rate per matching zone's location, empty rates outside any zone — gates checkout). **Currently returns Shopify flat rate; will be rewritten in D4 to compute `zone.basePrice + slot.priceAdjustment`.**
- afterAuth registers if `carrierServiceId` is null; webhook unregisters on APP_UNINSTALLED. The unregister and the Shop-row delete are decoupled so neither one's failure blocks the other.

✅ **Phase C · Order pipeline verification — merged 2026-05-03 (PR #41):**
- Cart-block writes `_delivery_method`, `_slot_id`, `_was_recommended` as `_`-prefixed line item properties via `/cart/change.js`. Mirrored from cart attributes so they appear in both Carrier Service rate requests and order `line_items[*].properties`.
- `webhooks.orders.create.tsx` upgraded: extracts customer email/phone from multiple paths, formats shipping address postal-style, transactionally creates `OrderLink` + increments slot `booked` + writes ordak_scheduling metafields + tags. Idempotent on Shopify retry (P2002 unique-violation handling).
- Pickup flow no longer requires postcode; pickup rendered as a banner instead of a slot grid (merchant-configurable hours).
- Native HTML date picker for the day chooser (replaced custom calendar grid).
- `prisma/seed.mjs` — additive test-data seeder (`DAYS_AHEAD = 14`).
- Reserves `WebhookDestination` table in schema (no UI/runtime; D9 builds the UI + dispatcher).
- End-to-end live at the time: orders #1007–#1013 on the now-retired `ordak-go-dev` all created OrderLinks with full email + postal-label addresses (rows since deleted in the 2026-05-06 Supabase cleanup). The same code runs on `ordakgo-v3`; a real customer order on that store is the open verification gate (see [`docs/WORKFLOW.md`](WORKFLOW.md)).

✅ **Phase C.5 · Delivery Customization Function — merged 2026-05-03 (PR #42):**

**Tagged:** `v0.5.0-pickup-checkout-locked` (commit `ec9ed6b`, app version `ordak-go-18`). Recoverable baseline if checkout filtering ever breaks — see `memory/checkpoint_pickup_checkout_locked.md`.

**Headline product goal achieved:** the cart-stage Pickup/Delivery choice locks the checkout shipping options. Customer cannot override at checkout. No native Ship/Pickup tabs. Verified live on the retired `ordak-go-dev`; the same Function bundle is loaded on `ordakgo-v3` but a real cart-stage-lock flow there is the open verification gate (see [`docs/WORKFLOW.md`](WORKFLOW.md)).

What landed:
- `extensions/delivery-rate-filter/` — TypeScript Shopify Function (target `cart.delivery-options.transform.run`) compiled to Wasm. Reads `_delivery_method` from cart line item attributes (preferred) OR cart-level `delivery_method` attribute (fallback). Hides delivery options whose `deliveryMethodType` AND handle/title/code don't match the cart-stage choice. Pickup pattern: `\b(?:pick[-_ ]?up|in[-_ ]?store|click[-_ ]?(?:and|&)[-_ ]?collect|collect)\b`.
- 7 vitest fixtures, all passing (incl. `delivery-not-fooled-by-collection.json` — false-positive guard for "collection point" / "collected" titles).
- Scope additions: `write_delivery_customizations`, `write_shipping`.
- Self-install convenience routes (admin UI replaces these in D6):
  - `/app/install-delivery-customization` — registers function as active DeliveryCustomization
  - `/app/install-carrier-service` — re-registers carrier service for shops that missed `afterAuth`
  - `/app/install-webhooks` — re-runs `shopify.registerWebhooks` for newly-declared topics
  - `/app/setup-au-shipping` — programs the AU shipping zone with both flat rates
  - `/app/backfill-orders` — re-runs orders/create handler against orders missed by webhook
- ORDERS_CREATE webhook topic added to `shopify.server.ts` `webhooks:` config (was missing).

✅ **Setup wizard rebuild — merged 2026-05-04 (PR #47):**
- 3-step wizard at `/app/setup`: Location → Zone → Rule (optional)
- URL-driven step state via `?step=1|2|3`; auto-routes to first incomplete step on entry
- Reuses validation logic from the granular `*.new.tsx` pages inline; uses Remix `<Form>` for embedded-admin compatibility
- Bundle: `app.setup-*.js` is 14.22 kB (3.91 kB gzipped)
- **Will be extended in D6** to pipe into the new D2/D3 admin (Per-Location shell + Per-Zone slot config) so the merchant ends the wizard with usable slots.

🔒 **Admin reschedule UI — PR #48 OPEN, HELD until D1 ships:**
- `app/routes/app.orders.$orderId.reschedule.tsx`: rebuilt as a real reschedule form (current-slot card + date dropdown + slot dropdown with capacity + price-aware disabled state + reason field)
- Held because the Phase D re-cut changes the slot data model (`Slot.locationId` → `Slot.zoneId`); needs a 1-line query update once D1 merges. Listed as D10.

❌ **The real v1 install-on-Bannos blockers (gaps the Pickeasy review exposed):**

These are the gaps that block installing on a real merchant's shop. They're sequenced as Phase D below.

1. **No slot management UI** — slots only exist via `prisma/seed.mjs`. Merchant cannot configure their own time windows, capacity, days, or per-zone slot pricing from the admin. The "merchant downloads the app from the App Store and configures it" story breaks here.
2. **No per-zone pricing** — `Zone` schema has no `basePrice` field. Carrier Service returns Shopify's flat rate, which means delivery price is hardcoded outside our app.
3. **No per-slot price adjustment** — slots are free-or-nothing today; merchants need to charge premiums for priority slots (e.g. 9am-11am priority +$10).
4. **No fast-checkout protection** — Shop Pay, Apple Pay, Google Pay, "Buy it now" express buttons skip the cart-block's slot selector. A customer can reach checkout with no scheduling attributes set, breaking the app's premise. Needs a Cart Validation Function.
5. **Settings page reads like the wrong app** — `/app/settings/recommendations` shows ML scoring weight sliders that don't map to anything a single-store bakery cares about. Needs to be replaced.
6. **Orders page is a flat list, not a calendar** — bakery operations think by date ("what's coming up Monday?"), not paginated rows.
7. **No webhook destinations UI** — schema reservation is in place but there's no admin UI to register external receivers. Needed for merchants who want to push orders to a delivery routing system.

⚠️ **Lower priority (not v1 blockers):**
- Privacy policy contact info, App Store icon/screenshots/listing — for v2
- Production hosting on Vercel — for v1 install on real shops; can defer if testing on dev store first
- npm audit vulnerabilities
- Webhook subscriptions migrated to toml (currently in code; works, but legacy)
- Performance/accessibility audit on the cart block (Built for Shopify standards)
- afterAuth + carrier-service registration don't fire on token-exchange refresh (only on initial install). The `/app/install-*` convenience routes are the manual workaround.
- Pickeasy's full "Rates by order value / product / time / days" rate conditions on zones — v2 enhancement.
- Pickeasy's "Product-based overrides" admin section — v2 enhancement.

## Phase D — re-cut (10 steps) — ✅ ALL MERGED (2026-05-04 / 2026-05-05)

D1 + D4-D10 are complete. D2 + D3 (per-Location admin shell + per-Zone admin) shipped as part of D6/D7 in modified form (the merged settings restructure subsumed those scopes). The active development frontier has moved to **Phase F** below.

The user's mental model and Bannos's real use case (1 location, 5 zones, per-zone pricing, per-slot price adjustments, fast-checkout protection, calendar view) drove this re-cut. See the matching memory entries: `feedback_slot_management_is_v1_blocker.md`, `feedback_zone_and_slot_pricing.md`, `feedback_cart_validation_function.md`, `feedback_orders_need_calendar_view.md`, `feedback_app_is_scheduling_not_optimization.md`, `reference_zapiet_pickeasy.md`.

### ✅ D1 — Schema migration (foundation for everything below) — MERGED

**Status:** Done. Verified in `prisma/schema.prisma`: `Zone.basePrice` (line 130), `Zone.excludePostcodes` (line 121), `Slot.zoneId` nullable + FK (line 190-191), `Slot.priceAdjustment` (line 203), `SlotTemplate.zoneId` + `priceAdjustment` (lines 239, 252). `Slot.locationId` was kept (not dropped) so pickup slots reach a location without a zone.

**Branch:** `feat/d1-slot-zone-pricing-schema`

- Drop `Slot.locationId`; add `Slot.zoneId String` (required, FK → Zone). Reach Location via `slot.zone.location`.
- Add `Slot.priceAdjustment Decimal? @db.Decimal(10,2) @default(0)`. Default $0 — only paid slots have non-zero values.
- Add `Zone.basePrice Decimal @db.Decimal(10,2)` (required). Backfill existing zones to 0; merchant must edit in admin.
- Add `Zone.excludePostcodes String[]` (default empty array).
- Pickup slots (no zone): keep `Slot.locationId` for pickup-only via a nullable union shape — or simpler, force every Location to have a default "pickup zone" with no postcodes. Decide in the migration design.
- Update `prisma/seed.mjs` to set `basePrice` on the seeded zone and `priceAdjustment = 0` on the seeded slots.
- Update affected queries: `app/routes/api.carrier-service.rates.tsx`, `app/routes/api.recommendations.locations.tsx`, `app/routes/api.recommendations.slots.tsx`, `app/services/recommendation-engine.server.ts`, `app/services/distance.server.ts`, `app/routes/app.orders._index.tsx`, `app/routes/webhooks.orders.create.tsx` (any code that reads `Slot.locationId`).

### D2 — Per-Location admin shell + multi-location

**Branch:** `feat/d2-per-location-admin`

- Locations index supports a list of locations with "Create location" button (today there's `/app/locations` — verify it handles many).
- Click into a location → new sidebar layout with sections: Location setup / Fulfillment type / Prep time & availability / Block dates & times / Zones list.
- Each section is a sub-route; sidebar persistent across them.
- Fulfillment type: checkboxes for Local Delivery + Store Pickup + min order value per type.
- Prep time & availability: maps to existing `Rule.lead_time` (consolidate the Rules concept inside the location).
- Block dates & times: maps to existing `Rule.blackout`, extended with time-of-day blocks.
- Zones list: shows zones for this location with zone names, base prices, status; click a zone → drilled into D3.

### D3 — Per-Zone admin (THE HEADLINE)

**Branch:** `feat/d3-per-zone-admin`

- Per-zone editor with sections: Postcodes (list + exclude OR km radius) / Base delivery price / Time slots & limits.
- Time slots & limits: per fulfillment type (delivery/pickup) → day tabs Mon-Sun → manual list of rows.
- Each row: Start Time, End Time, Capacity, Price adjustment.
- UX shortcuts: "Use same time slots for all days" checkbox, "Copy Monday slots to..." action, "Same as [other zone]" action.
- Slot type radio (Pickeasy parity): Only date / Date & time / Date & time range / Hide picker.

### ✅ D4 — Carrier Service callback rewrite — MERGED

**Status:** Done. Verified in `app/routes/api.carrier-service.rates.tsx` lines 280-282: `baseCents = toCents(matchedZone.basePrice); adjustmentCents = toCents(selectedSlot?.priceAdjustment); totalCents = baseCents + adjustmentCents`. Pickup uses single $0 rate plus optional slot premium (line 195). Postcode-match validation guards `_zone_id` against client tampering (lines 219-256). Shop-scoped slot lookup via `location.shopId` (lines 144-156).

**Branch:** `feat/d4-carrier-service-rewrite`

- Rewrite `app/routes/api.carrier-service.rates.tsx` to compute rate from our DB.
- Match destination postcode → Zone (postcode list match OR distance match).
- Read selected slot from cart's `_slot_id` line item property.
- Return rate = `zone.basePrice + slot.priceAdjustment`.
- Pickup remains $0 single rate.
- No more reliance on Shopify's flat-rate config — merchant configures all delivery pricing in our admin.
- Update the test fixtures and any docs that reference the flat-rate behavior.

### ✅ D5 — Cart-block UX cleanup + Cart Validation Function — MERGED (PR #54)

**Branch:** `feat/d5-cart-block-and-validation`

- Cart-block changes:
  - Show slot price `+$X` on tile when `priceAdjustment > 0`.
  - Hide "RECOMMENDED" badge by default (merchant can toggle on via Settings → Widget appearance).
  - Keep "Most available capacity" badge (default ON, also toggleable).
- New Wasm function at `extensions/cart-validation/`:
  - Target: `cart.validations.generate.run`.
  - Same shape as `extensions/delivery-rate-filter/` — TypeScript compiled to Wasm + vitest fixtures.
  - Rejects checkout if cart attributes don't include `delivery_method` + `_zone_id` (delivery) or `_slot_id`.
  - Customer-facing error message directs them back to cart for date+slot selection.
- Scope addition: `write_cart_validations` (verify exact name during build).
- Self-install convenience route at `/app/install-cart-validation` (admin UI replaces in D6).

### ✅ D6 — Wizard pipes into D2/D3 + Setup Guide checklist — MERGED (PR #55)

**Branch:** `feat/d6-wizard-and-setup-guide`

- Extend the wizard (PR #47) to add a "Time slots & pricing" step after Zone — pipes into the per-zone slot config UI from D3.
- Wizard ends with the merchant having usable slots+zones+prices on the storefront.
- Add a Setup Guide card to the dashboard (Pickeasy parity): checklist of "Create location ✓ / Create zone ✓ / Set time slots / Verify cart-block in theme / Test checkout" with progress and next-step CTAs.

### ✅ D7 — Settings page restructure — MERGED (PR #56)

**Branch:** `feat/d7-settings-restructure`

- Replace `/app/settings/recommendations` with a Settings index showing 4 cards (Pickeasy-shape):
  - **General configurations** — timezone, default lead time, currency, default slot duration
  - **Widget appearance** — cart-block colors, badge toggles ("RECOMMENDED" / "Most available capacity"), button label, banner text
  - **Integrations** — Webhook destinations live here (D9)
  - **Checkout rules** — toggleable validators (require delivery method, require date + slot, require valid zone match)
- Drop the recommendation scoring sliders entirely from UI; schema columns stay dormant (may resurrect in v2).
- Email notifications NOT included — Shopify handles order/customer emails natively (Settings → Notifications in Shopify admin). Add an info card linking to Shopify's notifications settings if useful.

### ✅ D8 — Orders calendar view — MERGED (PR #57)

**Branch:** `feat/d8-orders-calendar`

- Replace `/app/orders` home with a month/week calendar grid grouped by `slot.date`.
- Each day cell: small tiles displaying order number only (e.g. `#1013`).
- Two distinct colors: delivery (blue) vs pickup (green). Configurable via D7 Widget appearance later if needed.
- Click a day → drawer or list with full detail for that day's orders.
- Click an order tile → goes to the existing `/app/orders/$orderId/reschedule`.
- Day cell capacity pill: e.g. "12/30 booked" sums all slots' capacity vs booked for that date.
- "All orders" list view still available, also organized by due date (creation date doesn't matter to the merchant).

### ✅ D9 — Webhook destinations UI + dispatcher — MERGED (PR #58)

**Branch:** `feat/d9-webhook-destinations`

- Lives under Settings → Integrations.
- Admin UI: list/add/edit/delete destinations per shop. Fields = url, secret (HMAC signing), enabled toggle, eventTypes filter.
- Dispatcher runtime: hook into `EventLog` writes (or run a small queue worker). For each enabled destination whose `eventTypes` matches the event, POST the payload signed with the destination's HMAC secret. Retries with backoff on 5xx; mark destination as failing after N consecutive failures.
- Default state for a new destination: `enabled: false`. Merchant turns on after configuring on receiving end.

### ✅ D10 — Finalize PR #48 admin reschedule — MERGED (PR #59)

**Branch:** continue on `feat/restore-reschedule` (PR #48)

- Update the slot lookup query to traverse `slot.zone.locationId` instead of `slot.locationId`.
- Adjust the "available slots" loader to filter by zone (slots are now per-zone, not per-location+fulfillment).
- Re-verify on dev shop and merge.

## Phase F — App Store submission (active)

The active plan supersedes Phase E below. See **`/Users/panospanayi/.claude/plans/expressive-waddling-squirrel.md`** for the full v1+v2 sequence: foundation lockdown → cart/checkout bug fix → end-to-end verification → settings/wizard polish → cart-block polish → App Store readiness → submission as **unlisted public app** → post-approval install on Bannoscakes + Flour Lane.

Locked decision: distribution mode is **public, unlisted**. Custom distribution does not span both stores on non-Plus plans. Functions activate automatically once App-Store-distributed.

### Phase F status (2026-05-07)

✅ **Code-side App Store gates landed and held in production:**
- Privacy policy at `/policies/privacy` with `panos@bannos.com.au` contact (PR #80)
- GDPR `customers/data_request` real implementation + `/app/data-requests` admin export (PR #79)
- CUSTOMERS_REDACT phone-redaction copy-paste bug fixed (PR #79)
- OAuth scopes reduced from 7 to 5 (PR #78)
- REST API audit: clean (PR #77)
- Carrier callback warm p95 = 182ms (PR #74)
- Smoke + latency scripts (`npm run smoke:carrier`, `npm run latency:carrier`) — PRs #73, #74
- $15 hardcode removed from `/app/setup-au-shipping` + cleanup route added (PR #72)
- Setup Guide deep-links to cart template (PRs #68, #70)
- Cart-block writes `_zone_id` correctly (PR #66, the original cart-vs-checkout fix)
- Vercel production hosting on syd1 (PR #64)
- Cart-block drawer placement fixed for Horizon (PR #90, `ordak-go-37`) — scope-aware `findHostTarget` + 5 unit tests
- Per-location pickup hours admin (PR #95, `ordak-go-38`) — closes the slot-management gap; new "Pickup hours" tab on `/app/locations/:id`, shared `SlotsEditor` component, smart wizard detour. See `memory/pickup_admin_per_location.md`.
- Phase 1 verification gate CLOSED — real test orders #1001 + #1002 on `ordakgo-v3` (see `memory/next_steps_plan.md` for the evidence)

❌ **User-action items still outstanding for App Store submission (Phase 2):**
- 5.3 App icon 1200×1200 PNG
- 5.4 Screenshots (3–6 @ 1600×900) — capture from the new admin pages on `ordakgo-v3`
- 5.4b Demo screencast (60–90s, English narration)
- 5.5 Demo store reviewer instructions (use `ordakgo-v3.myshopify.com`, password `theuld`)
- 5.6 Listing copy (intro/details/features) — Claude can draft, user approves
- 5.6b Set listing pricing as "Free" in Partners
- 5.8d Carrier-service re-registration test (uninstall+reinstall on `ordakgo-v3`) — destructive
- 5.9 Stack-rot deferred items (Renovate config, quarterly cron) — mostly post-approval
- 5.10 Final pre-submission smoke test on `ordakgo-v3`

## Phase E · App Store readiness (legacy — superseded by Phase F)

Defer until Phase D lands and dev-store testing is solid.

- Privacy policy: replace placeholder text with real contact info
- App Store assets: icon (1200×1200), 3–5 screenshots, listing copy
- Production hosting: deploy to Vercel, set environment variables, smoke-test with `bannoscakes` dev store from production
- Migrate webhook subscriptions to toml (declarative)
- Implement remaining stack-rot defense layers: deprecation alarm, quarterly upgrade cron, Renovate config (see `memory/stack_rot_defense.md`)
- Performance audit: Lighthouse ≥90, bundle size ≤35KB (cart-block currently 13.45KB ✓; cart-validation function will add another ~2-5KB to deployed footprint)
- Accessibility audit
- Rate limiting on public API routes
- Run security audit: `npm audit fix`, address remaining issues
- afterAuth + carrier-service registration don't fire on token-exchange refresh — either fix the SDK hook or add a reconciliation cron.

**Estimate:** 2–3 days, parallelizable with merchant testing.

## Suggested order of operations

1. ~~**Phase A** (cart block)~~ — done
2. ~~**Phase B** (carrier service)~~ — done
3. ~~**Phase C** (order pipeline)~~ — done
4. ~~**Phase C.5** (delivery customization function)~~ — done
5. ~~**Promote Dev → main**~~ — done (PR #43 + PR #44, 2026-05-03)
6. ~~**Setup wizard rebuild** (PR #47)~~ — done 2026-05-04
7. **Phase D in sequence**: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8 → D9 → D10. D1 is the foundation; D2-D5 unblock the merchant; D6-D9 round out the admin; D10 closes PR #48.
8. **Install on Bannos as the canary** — only after D1-D5 land. Walk through the live-setup checklist in §Phase C.5 above.
9. **Install on Flour Lane** once Bannos is stable.
10. **Phase E** after both stores are live and stable.

## Out of scope for v1

- Pickeasy's full rate conditions (by order value, product, time, days) — v2.
- Pickeasy's product-based overrides — v2.
- Email notifications custom UI — Shopify handles natively.
- Checkout UI Extension (Plus only; not relevant for Bannos/Flour Lane — they don't want Plus, see `memory/no_shopify_plus.md`).
- ML-driven slot recommendations — schema columns dormant; UI hidden in v1.
- Multi-language / i18n — not on the v1 path.

## Decision log

- **Why theme app extension and not just better script tags?** Built for Shopify won't accept script tags for new apps; theme app extensions install via merchant theme editor and are versioned by Shopify, surviving theme updates and Shopify changes.
- **Why Carrier Service over Checkout UI Extension?** Checkout UI Extensions require Shopify Plus. Carrier Service works on all plans and gates the available shipping rates.
- **Why a Delivery Customization Function in addition to Carrier Service?** Carrier Service can only return shipping rates — it cannot toggle Shopify checkout's mode (delivery vs pickup) or hide irrelevant rates. The legacy Local Delivery app's headline behavior requires Shopify Functions with target `cart.delivery-options.transform.run`.
- **Why a second Function (Cart Validation) for fast-checkout protection?** Shop Pay, Apple Pay, Google Pay, and "Buy it now" buttons skip the cart entirely. The cart-block's client-side validation can't catch these. Only a Function with target `cart.validations.generate.run` blocks them at Shopify's checkout layer.
- **Why are slots per Zone, not per Location?** Bannos has 1 location with 5 zones, and the merchant wants different time windows per zone (e.g. 4 inner-Sydney zones share 8am-6pm 2hr windows; the 40km-out zone has only 3 windows with 2 of them charging extra). Pickeasy uses per-Location slots, but Bannos's use case requires per-Zone flexibility.
- **Why no auto-generator (operating hours + duration + stagger)?** User explicitly rejected the "schedule template" terminology and wanted manual per-day-of-week entry to match Pickeasy's pattern. The overlapping windows seen in the example bakery cart (8-10, 8:30-10:30, 9-11, ...) were all manually entered.
- **Why is delivery pricing in our DB and not Shopify's flat rates?** Bannos has 5 zones each with a different price, AND each slot can carry a price adjustment. Shopify's flat-rate config doesn't compose per-slot adjustments. The Carrier Service callback (D4) computes the rate from `zone.basePrice + slot.priceAdjustment` so all pricing is configurable in our admin.
- **Why hide the recommendations machinery in v1?** The settings page exposed ML scoring weights (Capacity 40% / Distance 30% / Route Eff 20% / Personalization 10%) that don't map to anything a single-store bakery cares about. Schema columns stay dormant; UI hidden. May resurrect in v2 if multi-location merchants ask for slot recommendations.
- **Why is PR #48 (admin reschedule) held until D1 ships?** D1 changes the slot data model (`Slot.locationId` → `Slot.zoneId`). The reschedule UI's slot lookup query needs a 1-line update afterward. Easier to batch the update with D10 than to merge twice.
- **Why hold off Prisma 7?** Its config-file rearchitecture isn't yet supported by Shopify's Prisma session-storage adapter (peers `^6.19.0`). Will revisit when adapter catches up.
- **Why no direct ordak delivery integration in v1?** The existing `bannoscakes-ordak-ui` manufacturing system already consumes Shopify webhooks and forwards delivery orders to ordak.com.au. Ordak Go's job is upstream: tag the Shopify order with scheduling info so the existing Edge Functions read it. See `memory/integration_target.md`.
- **Why line item properties instead of cart attributes for the Carrier Service contract?** Shopify's Carrier Service rate-request body does NOT include `note_attributes`. Only `origin / destination / items / currency`. Cart-block must mirror the cart attributes onto every line as `_`-prefixed properties. Documented in `app/routes/api.carrier-service.rates.tsx`.
- **Why webhook returns 503 on Shopify-write failure (PR #42 review fix)?** Returning 200 caused a split-brain: our DB wrote OrderLink + bumped slot capacity, but Shopify's order didn't get our metafields/tags. 503 makes Shopify retry the webhook so the merchant-facing Shopify state and our DB state stay aligned.
