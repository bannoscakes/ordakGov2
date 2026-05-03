# PLAN — what's next for Ordak Go

Last updated: 2026-05-03 — Phase C (PR #41) and Phase C.5 (PR #42) merged into `Dev` and verified live on `ordak-go-dev`. Dev is ahead of `main` by 39 commits — promotion PR pending.

## Where we are

✅ **Foundation done:**
- Stack upgraded to current Shopify SDKs (Polaris 13, app-remix 4.2, shopify-api 13, Prisma 6.19, Vite 5)
- Linked to Partners app **Ordak Go** under **P&T Group** org
- Supabase project provisioned, schema migrated
- Dev store `ordak-go-dev.myshopify.com` created
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
- `app/routes/api.carrier-service.rates.tsx` — POST callback that branches on `_delivery_method` line item property (pickup → \$0 single rate, delivery → rate per matching zone's location, empty rates outside any zone — gates checkout).
- afterAuth registers if `carrierServiceId` is null; webhook unregisters on APP_UNINSTALLED. The unregister and the Shop-row delete are decoupled so neither one's failure blocks the other.

✅ **Phase C · Order pipeline verification — merged 2026-05-03 (PR #41):**
- Cart-block writes `_delivery_method`, `_slot_id`, `_was_recommended` as `_`-prefixed line item properties via `/cart/change.js`. Mirrored from cart attributes so they appear in both Carrier Service rate requests and order `line_items[*].properties`.
- `webhooks.orders.create.tsx` upgraded: extracts customer email/phone from multiple paths, formats shipping address postal-style, transactionally creates `OrderLink` + increments slot `booked` + writes ordak_scheduling metafields + tags. Idempotent on Shopify retry (P2002 unique-violation handling).
- Pickup flow no longer requires postcode; pickup rendered as a banner instead of a slot grid (merchant-configurable hours).
- Native HTML date picker for the day chooser (replaced custom calendar grid).
- `prisma/seed.mjs` — additive test-data seeder.
- Reserves `WebhookDestination` table in schema (no UI/runtime; design-now-build-later).
- End-to-end live: orders #1007–#1013 on `ordak-go-dev` all created OrderLinks with full email + postal-label addresses.

✅ **Phase C.5 · Delivery Customization Function — merged 2026-05-03 (PR #42):**

**Tagged:** `v0.5.0-pickup-checkout-locked` (commit `ec9ed6b`, app version `ordak-go-18`). Recoverable baseline if checkout filtering ever breaks — see `memory/checkpoint_pickup_checkout_locked.md`.

**Headline product goal achieved:** the cart-stage Pickup/Delivery choice locks the checkout shipping options. Customer cannot override at checkout. No native Ship/Pickup tabs. Verified live on `ordak-go-dev`.

What landed:
- `extensions/delivery-rate-filter/` — TypeScript Shopify Function (target `cart.delivery-options.transform.run`) compiled to Wasm. Reads `_delivery_method` from cart line item attributes (preferred) OR cart-level `delivery_method` attribute (fallback). Hides delivery options whose `deliveryMethodType` AND handle/title/code don't match the cart-stage choice. Pickup pattern: `\b(?:pick[-_ ]?up|in[-_ ]?store|click[-_ ]?(?:and|&)[-_ ]?collect|collect)\b`.
- 7 vitest fixtures, all passing (incl. `delivery-not-fooled-by-collection.json` — false-positive guard for "collection point" / "collected" titles).
- Scope additions: `write_delivery_customizations`, `write_shipping`.
- Self-install convenience routes (Phase D will replace with merchant UI):
  - `/app/install-delivery-customization` — registers function as active DeliveryCustomization
  - `/app/install-carrier-service` — re-registers carrier service for shops that missed `afterAuth`
  - `/app/install-webhooks` — re-runs `shopify.registerWebhooks` for newly-declared topics
  - `/app/setup-au-shipping` — programs the AU shipping zone with both flat rates
  - `/app/backfill-orders` — re-runs orders/create handler against orders missed by webhook
- ORDERS_CREATE webhook topic added to `shopify.server.ts` `webhooks:` config (was missing).
- **PR #42 review hardening (`c3160b7`):** `MutationResult` discriminated union from metafield service; cart writer surfaces `res.ok` failures + recovers from 422; webhook returns 503 on Shopify failure (was 200, causing split-brain); `parseScore` rejects NaN/Infinity; cross-shop guard on existing-OrderLink branch; install routes surface per-topic / `userErrors` / `active` status; `\bcollect\b` word boundary.

**Live setup (working baseline, all configured on `ordak-go-dev`):**
- Markets: Australia enabled
- Shipping zone "Australia" with flat rates: "Standard delivery" $15 AUD + "Pickup at Annandale" $0 AUD
- Shopify-native Local Pickup: OFF on every location (otherwise tabs override our lock)
- Delivery customization installed and enabled
- Protected Customer Data: "Store management, App functionality" reasons selected (required for ORDERS_CREATE subscription)

**Production install on Bannos** will need:
- Same shipping zone setup (their existing AU zones likely already cover it)
- Local Pickup OFF on locations
- Protected Customer Data approval as part of App Store submission (Phase E)
- Re-run the install convenience routes once after install

❌ **Critical gaps blocking v1 install on Bannos + Flour Lane:**
1. ~~No theme app extension~~ — Phase A ✓
2. ~~No Carrier Service~~ — Phase B ✓
3. ~~No verified end-to-end order pipeline~~ — Phase C ✓
4. ~~No checkout-mode lock~~ — Phase C.5 ✓
5. **Dev → main promotion PR not yet merged** — `Dev` is 39 commits ahead of `main`; production-ready code lives on Dev. Open the PR, smoke on dev store, merge.
6. Two admin routes stubbed (setup wizard, reschedule) — usable but feature-incomplete (Phase D)

⚠️ **Deferred (not v1 blockers):**
- Privacy policy contact info, App Store icon/screenshots/listing — for v2
- Production hosting on Vercel — for v1 install on real shops; can defer if testing on dev store first
- npm audit vulnerabilities
- Webhook subscriptions migrated to toml (currently in code; works, but legacy)
- Performance/accessibility audit on the new cart block (Built for Shopify standards)

## The plan — phases

### Phase A · Cart app block — DONE (PR #39)

See "Where we are" above.

### Phase B · Carrier Service — DONE (PR #40)

See "Where we are" above.

### Phase C · Order pipeline verification — DONE (PR #41)

See "Where we are" above.

### Phase C.5 · Delivery Customization Function — DONE (PR #42, tag `v0.5.0-pickup-checkout-locked`)

See "Where we are" above.

### Phase D · Restore stubbed admin — NEXT
- `app/routes/app.setup.tsx`: rebuild setup wizard against current schema (use `postalCode` not `postcode`, `type` not `ruleType`, RangeSlider v13 onChange signature, proper discriminated-union narrowing for action data)
- `app/routes/app.orders.$orderId.reschedule.tsx`: rebuild admin reschedule (FormData typing, narrowing)
- Polish pass on existing admin routes (implicit-any warnings, the `as any` on metafield service GraphQL client — though metafield service is now typed via `MutationResult`, so this may already be partially addressed)
- Add `logger.error` to the remaining admin-form catch blocks if any silent paths still exist (the silent-failure-hunter agent ran on PR #42 — re-run on Phase D scope)
- Investigate Polaris NavMenu prefetch 404s (`/app/se*.recommendations` etc.)
- Surface `Shop.carrierServiceId IS NULL` in the admin home banner so a failed registration is visible to the merchant instead of a silent broken checkout (carried over from Phase E shortlist).

**Estimate:** 1 day. **Branch:** `feat/restore-admin`. Can ship to v1 without this if the manual setup steps in the current placeholder are acceptable.

### Phase E · App Store readiness
Defer until A–D land and dev-store testing is solid.

- Privacy policy: replace placeholder text with real contact info
- App Store assets: icon (1200×1200), 3–5 screenshots, listing copy
- Production hosting: deploy to Vercel, set environment variables, smoke-test with `bannoscakes` dev store from production
- Migrate webhook subscriptions to toml (declarative)
- Implement remaining stack-rot defense layers: deprecation alarm, quarterly upgrade cron, Renovate config (see `memory/stack_rot_defense.md`)
- Performance audit: Lighthouse ≥90, bundle size ≤35KB (currently 13.45KB ✓)
- Accessibility audit
- Rate limiting on public API routes
- Run security audit: `npm audit fix`, address remaining issues
- afterAuth + carrier-service registration don't fire on token-exchange refresh (only on initial install). Existing installs need uninstall+reinstall to bootstrap. Either fix the SDK hook or add a reconciliation cron. The `/app/install-*` convenience routes are the manual workaround until then.

**Estimate:** 2–3 days, parallelizable with merchant testing.

## Suggested order of operations

1. ~~**Phase A** (cart block)~~ — done
2. ~~**Phase B** (carrier service)~~ — done
3. ~~**Phase C** (order pipeline)~~ — done
4. ~~**Phase C.5** (delivery customization function)~~ — done
5. **Promote Dev → main** — open the PR, run smoke on dev store, merge so production-ready code is on the default branch
6. **Install on Bannos as the canary** — manual smoke testing on a real shop with real (test) orders. Walk through the live-setup checklist above.
7. **Install on Flour Lane** once Bannos is stable
8. **Phase D** in parallel with Bannos rollout (admin gaps don't block customer-facing flow)
9. **Phase E** after both stores are live and stable

## Out of scope for now

- Plug-in webhook destination feature (per business requirement: "design pluggable now, build later" — schema reservation landed in Phase C)
- Checkout UI Extension (Plus only; not relevant for Bannos/Flour Lane — they don't want Plus, see `memory/no_shopify_plus.md`)
- ML-driven slot recommendations (current weighted-scoring algorithm is sufficient; future enhancement)
- Multi-language / i18n (not on the v1 path)

## Decision log

- **Why theme app extension and not just better script tags?** Built for Shopify won't accept script tags for new apps; theme app extensions install via merchant theme editor and are versioned by Shopify, surviving theme updates and Shopify changes.
- **Why Carrier Service over Checkout UI Extension?** Checkout UI Extensions require Shopify Plus. Carrier Service works on all plans and gates the available shipping rates, achieving the same "lock the choice" outcome.
- **Why a Delivery Customization Function in addition to Carrier Service?** Carrier Service can only return shipping rates — it cannot toggle Shopify checkout's mode (delivery vs pickup) or hide irrelevant rates. The legacy Local Delivery app's headline behavior ("the choice you made in cart determines what you see at checkout — no confusion") requires Shopify Functions with target `cart.delivery-options.transform.run`. Available on all plans, deploys with the app, surfaces under Settings → Shipping and delivery → Delivery customizations.
- **Why hold off Prisma 7?** Its config-file rearchitecture isn't yet supported by Shopify's Prisma session-storage adapter (peers `^6.19.0`). Will revisit when adapter catches up.
- **Why no direct ordak delivery integration in v1?** The existing `bannoscakes-ordak-ui` manufacturing system (Vite + Supabase) already consumes Shopify webhooks and forwards delivery orders to ordak.com.au → ordak delivery. Ordak Go's job is upstream of that: tag the Shopify order with scheduling info so the existing Edge Functions read it. See `memory/integration_target.md`.
- **Why line item properties instead of cart attributes for the Carrier Service contract?** Shopify's Carrier Service rate-request body does NOT include `note_attributes`. Only `origin / destination / items / currency`. Cart-block must mirror the cart attributes onto every line as `_`-prefixed properties, which DO appear at `rate.items[*].properties` and at order line items. Documented in `app/routes/api.carrier-service.rates.tsx`.
- **Why webhook returns 503 on Shopify-write failure (PR #42 review fix)?** Returning 200 caused a split-brain: our DB wrote OrderLink + bumped slot capacity, but Shopify's order didn't get our metafields/tags. 503 makes Shopify retry the webhook so the merchant-facing Shopify state and our DB state stay aligned.
- **Why the `_recommendation_score` line property was removed from cart-block writes?** Adding it would have stamped another row per line item under the merchant's "Additional details" panel, conflicting with the "keep the admin order view clean" feedback. The score lives in `RecommendationSelected` events as the system of record for analytics; `OrderLink.recommendationScore` is null for new orders going through this flow but remains populated for backfilled orders (the webhook still extracts it if present).
