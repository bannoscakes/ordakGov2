# PLAN — what's next for Ordak Go

Last updated: 2026-05-02. Snapshot after stack upgrade + dev boot path landed (PR #37 merged into `Dev`).

## Where we are

✅ **Foundation done:**
- Stack upgraded to current Shopify SDKs (Polaris 13, app-remix 4.2, shopify-api 13, Prisma 6.19, Vite 5)
- Linked to Partners app **Ordak Go** under **P&T Group** org
- Supabase project provisioned, schema migrated
- Dev store `ordak-go-dev.myshopify.com` created
- 3-terminal local boot working (see [`DEV_SETUP.md`](DEV_SETUP.md))
- App installs on dev store via token-exchange auth, embedded admin renders, webhooks fire, DB writes confirmed
- 0 TypeScript errors, production build passes

❌ **Critical gaps blocking v1 install on Bannos + Flour Lane:**
1. No theme app extension — current cart UX is fragile `public/*.js` (the exact failure mode we're escaping)
2. No Carrier Service — customers can still bypass the cart-stage delivery/pickup choice at checkout (the original pain point)
3. No verified end-to-end order pipeline — webhook tagging logic exists but hasn't been tested with the real cart attribute → order flow
4. Two admin routes stubbed (setup wizard, reschedule) — usable but feature-incomplete

⚠️ **Deferred (not v1 blockers):**
- Privacy policy contact info, App Store icon/screenshots/listing — for v2
- Production hosting on Vercel — for v1 install on real shops; can defer if testing on dev store first
- 21 npm audit vulnerabilities (9 moderate, 12 high)
- Webhook subscriptions migrated to toml (currently in code; works, but legacy)
- Performance/accessibility audit on the new cart block (Built for Shopify standards)

## The plan — 5 phases, each its own PR off `Dev`

### Phase A · Cart app block (theme app extension)
**The single highest-impact change.** Replaces `public/ordak-widget.js` + `fulfillment-toggle.js` + `postcode-checker.js` with a proper Shopify theme app extension that merchants install via the theme editor.

- Create `extensions/cart-block/` (use `shopify app generate extension` for scaffold)
- Components: delivery/pickup toggle → postcode check → calendar + slot picker → location picker for pickup
- Backend: calls existing `/api/eligibility/check`, `/api/recommendations/slots`, `/api/recommendations/locations`
- Cart writes: `attributes.delivery_method`, `attributes.slot_id`, `attributes.slot_date`, `attributes.slot_time_start`, `attributes.slot_time_end`, `attributes.location_id`
- UX per `docs/app/CHECKOUT_SPEC.md` and `docs/app/RECOMMENDATIONS.md`: highlight recommended slot, show "Recommended" badge, lazy-load on visibility, ≤35KB gzip target
- Accessibility: ARIA, keyboard nav, screen-reader friendly

**Estimate:** 1–2 days. **Branch:** `feat/cart-app-block`.

### Phase B · Carrier Service (the checkout lock)
Solves the original pain: customer picks pickup in cart, then changes shipping at checkout.

- Implement Carrier Service callback endpoint
- Reads cart attributes set by Phase A
- If `delivery_method == "pickup"`: returns single `{ name: "Pickup", price: 0 }` rate
- If `delivery_method == "delivery"`: returns delivery rates for the chosen slot/location
- Register Carrier Service on app install via `afterAuth` hook
- Remove stale Carrier Service registration on uninstall

**Estimate:** 1 day. **Branch:** `feat/carrier-service`. Could merge with Phase A if scope allows.

### Phase C · Order pipeline verification
Closes the loop: cart attributes → Shopify order → existing `webhooks.orders.create` handler → tags/metafields → manufacturing system reads.

- Verify `webhooks.orders.create.tsx` correctly reads our cart attributes (currently expects an `OrderLink` to already exist; needs adjustment to create one from cart attributes if not yet linked)
- Decrement slot booking count when order is created
- Apply tags/metafields/note (already implemented; verify it runs)
- End-to-end test on `ordak-go-dev`: place an order → see Shopify order with our scheduling tags → confirm payload shape matches what `bannoscakes-ordak-ui` Edge Functions expect
- Reserve `WebhookDestination` table in schema (no UI/runtime; design-now-build-later per business requirement)

**Estimate:** 0.5–1 day. **Branch:** `feat/order-pipeline`.

### Phase D · Restore stubbed admin
- `app.setup.tsx`: rebuild setup wizard against current schema (use `postalCode` not `postcode`, `type` not `ruleType`, RangeSlider v13 onChange signature, proper discriminated-union narrowing for action data)
- `app.orders.$orderId.reschedule.tsx`: rebuild admin reschedule (FormData typing, narrowing)
- Polish pass on existing admin routes (implicit-any warnings, the `as any` on metafield service GraphQL client)

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

**Estimate:** 2–3 days, parallelizable with merchant testing.

## Suggested order of operations

1. **Phase A** now (cart block) — highest leverage, unblocks B and C
2. **Phase B** immediately after (carrier service) — closes the security hole
3. **Phase C** to verify the end-to-end works on dev store
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
