# PLAN — what's next for Ordak Go

Last updated: 2026-05-02 — Phase A (PR #39) and Phase B (PR #40) merged into `Dev`.

## Where we are

✅ **Foundation done:**
- Stack upgraded to current Shopify SDKs (Polaris 13, app-remix 4.2, shopify-api 13, Prisma 6.19, Vite 5)
- Linked to Partners app **Ordak Go** under **P&T Group** org
- Supabase project provisioned, schema migrated
- Dev store `ordak-go-dev.myshopify.com` created
- App installs on dev store via token-exchange auth, embedded admin renders, webhooks fire, DB writes confirmed
- 0 TypeScript errors, production build passes

✅ **Phase A · Cart app block (theme app extension) — merged 2026-05-02 (PR #39):**
- `extensions/cart-block/` — Preact theme app extension, gzipped bundle 12.5KB (under the 35KB budget). Source split into `extensions/_cart-block-src/` so Shopify CLI's strict "only assets/blocks/locales/snippets" enforcement passes.
- 5 storefront proxy routes (`apps.proxy.eligibility.check`, `recommendations.{locations,slots}`, `events.recommendation-{viewed,selected}`) all wired through `app/utils/app-proxy.server.ts` `appProxyAction()` helper that authenticates and pins `shopDomain`/`shopifyDomain` from session.
- One-command dev loop: `npm run dev:up` / `dev:down` / `dev:logs`. Stable named cloudflared tunnel `ordak-go-dev` permanently routed via Cloudflare DNS to `https://dev.ordak.vip`.
- afterAuth `prisma.shop.upsert` so api.* handlers find a Shop row on fresh installs.
- 6 admin form routes (locations.new/$id, zones.new/$id, rules.new/$id) switched from raw `<form method="post">` to Remix's `<Form>`.

✅ **Phase B · Carrier Service (the checkout lock) — merged 2026-05-02 (PR #40):**
- `Shop.carrierServiceId` column + migration `20260502075923_add_carrier_service_id`.
- `app/services/carrier-service.server.ts` — register/unregister via Admin GraphQL `carrierServiceCreate` / `carrierServiceDelete`.
- `app/routes/api.carrier-service.rates.tsx` — POST callback that branches on `_delivery_method` line item property (pickup → \$0 single rate, delivery → rate per matching zone's location, empty rates outside any zone — gates checkout).
- afterAuth registers if `carrierServiceId` is null; webhook unregisters on APP_UNINSTALLED. The unregister and the Shop-row delete are decoupled so neither one's failure blocks the other.

❌ **Critical gaps blocking v1 install on Bannos + Flour Lane:**
1. ~~No theme app extension~~ — Phase A ✓
2. ~~No Carrier Service~~ — Phase B ✓
3. **No verified end-to-end order pipeline** — webhook tagging logic exists but hasn't been tested with the real cart attribute → order flow (Phase C, next)
4. Two admin routes stubbed (setup wizard, reschedule) — usable but feature-incomplete (Phase D)
5. Cart-block doesn't yet write `_delivery_method`/`_slot_id`/etc. as line item properties, which Phase B's Carrier Service callback needs to read. Defer to Phase C since it ties into the cart→order pipeline anyway.

⚠️ **Deferred (not v1 blockers):**
- Privacy policy contact info, App Store icon/screenshots/listing — for v2
- Production hosting on Vercel — for v1 install on real shops; can defer if testing on dev store first
- npm audit vulnerabilities
- Webhook subscriptions migrated to toml (currently in code; works, but legacy)
- Performance/accessibility audit on the new cart block (Built for Shopify standards)

## The plan — 5 phases, each its own PR off `Dev`

### Phase A · Cart app block — DONE (PR #39)

See "Where we are" above.

### Phase B · Carrier Service — DONE (PR #40)

See "Where we are" above.

### Phase C · Order pipeline verification — NEXT
Closes the loop: cart attributes → Shopify order → existing `webhooks.orders.create` handler → tags/metafields → manufacturing system reads.

- **Cart-block writes** `_delivery_method`, `_slot_id`, `_slot_date`, `_slot_time_start`, `_slot_time_end`, `_location_id` as `_`-prefixed line item properties on every line (via `/cart/change.js`). Same info as cart attributes but propagates into Carrier Service rate requests and order line items.
- Verify `webhooks.orders.create.tsx` correctly reads our cart attributes/line item properties (currently expects an `OrderLink` to already exist; needs adjustment to create one from cart context if not yet linked).
- Decrement slot `booked` count when order is created.
- Apply tags/metafields/note (already implemented; verify it runs).
- End-to-end test on `ordak-go-dev`: place a real test order → see Shopify order with our scheduling tags → confirm payload shape matches what `bannoscakes-ordak-ui` Edge Functions expect.
- Reserve `WebhookDestination` table in schema (no UI/runtime; design-now-build-later per business requirement).

**Estimate:** 0.5–1 day. **Branch:** `feat/order-pipeline`.

### Phase D · Restore stubbed admin
- `app.setup.tsx`: rebuild setup wizard against current schema (use `postalCode` not `postcode`, `type` not `ruleType`, RangeSlider v13 onChange signature, proper discriminated-union narrowing for action data)
- `app.orders.$orderId.reschedule.tsx`: rebuild admin reschedule (FormData typing, narrowing)
- Polish pass on existing admin routes (implicit-any warnings, the `as any` on metafield service GraphQL client)
- Add `logger.error` to all 8 admin-form catch blocks (tracked as task #19 — silent-failure review finding from PR #39).
- Investigate Polaris NavMenu prefetch 404s (`/app/se*.recommendations` etc. — task #13).

**Estimate:** 1 day. **Branch:** `feat/restore-admin`. Can ship to v1 without this if the manual setup steps in the current placeholder are acceptable.

### Phase E · App Store readiness
Defer until A–D land and dev-store testing is solid.

- Privacy policy: replace placeholder text with real contact info
- App Store assets: icon (1200×1200), 3–5 screenshots, listing copy
- Production hosting: deploy to Vercel, set environment variables, smoke-test with `bannoscakes` dev store from production
- Migrate webhook subscriptions to toml (declarative)
- Implement remaining stack-rot defense layers: deprecation alarm, quarterly upgrade cron, Renovate config (see `memory/stack_rot_defense.md`)
- Performance audit: Lighthouse ≥90, bundle size ≤35KB
- Accessibility audit
- Rate limiting on public API routes
- Run security audit: `npm audit fix`, address remaining issues
- afterAuth + carrier-service registration don't fire on token-exchange refresh (only on initial install) — task #12. Existing installs need uninstall+reinstall to bootstrap. Either fix the SDK hook or add a reconciliation cron.
- Surface `Shop.carrierServiceId IS NULL` in the admin home banner so a failed registration is visible to the merchant instead of a silent broken checkout.

**Estimate:** 2–3 days, parallelizable with merchant testing.

## Suggested order of operations

1. ~~**Phase A** now (cart block)~~ — done
2. ~~**Phase B** immediately after (carrier service)~~ — done
3. **Phase C** next — verify the end-to-end works on dev store, fold in cart-block line-item-property writes
4. **Install on Bannos as the canary** — manual smoke testing on a real shop with real (test) orders
5. **Install on Flour Lane** once Bannos is stable
6. **Phase D** in parallel with Bannos rollout (admin gaps don't block customer-facing flow)
7. **Phase E** after both stores are live and stable

## Out of scope for now

- Plug-in webhook destination feature (per business requirement: "design pluggable now, build later" — schema reservation only in Phase C)
- Checkout UI Extension (Plus only; not relevant for Bannos/Flour Lane unless they go Plus)
- ML-driven slot recommendations (current weighted-scoring algorithm is sufficient; future enhancement)
- Multi-language / i18n (not on the v1 path)

## Decision log

- **Why theme app extension and not just better script tags?** Built for Shopify won't accept script tags for new apps; theme app extensions install via merchant theme editor and are versioned by Shopify, surviving theme updates and Shopify changes.
- **Why Carrier Service over Checkout UI Extension?** Checkout UI Extensions require Shopify Plus. Carrier Service works on all plans and gates the available shipping rates, achieving the same "lock the choice" outcome.
- **Why hold off Prisma 7?** Its config-file rearchitecture isn't yet supported by Shopify's Prisma session-storage adapter (peers `^6.19.0`). Will revisit when adapter catches up.
- **Why no direct ordak delivery integration in v1?** The existing `bannoscakes-ordak-ui` manufacturing system (Vite + Supabase) already consumes Shopify webhooks and forwards delivery orders to ordak.com.au → ordak delivery. Ordak Go's job is upstream of that: tag the Shopify order with scheduling info so the existing Edge Functions read it. See `memory/integration_target.md`.
- **Why line item properties instead of cart attributes for the Carrier Service contract?** Shopify's Carrier Service rate-request body does NOT include `note_attributes`. Only `origin / destination / items / currency`. Cart-block must mirror the cart attributes onto every line as `_`-prefixed properties, which DO appear at `rate.items[*].properties` and at order line items. Documented in `app/routes/api.carrier-service.rates.tsx`.
