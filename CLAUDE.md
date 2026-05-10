# CLAUDE.md

Onboarding for Claude Code sessions in this repo. Read top-to-bottom once per session.

> **Before doing any work, read [`docs/WORKFLOW.md`](docs/WORKFLOW.md).** It defines (a) the two independent deploy pipelines (Vercel auto for the admin app vs Shopify CDN manual for extension bundles), (b) what counts as "verified" (compile/build/grep/DOM-manipulation do **not** count), and (c) the cart-block-specific deploy ritual that prevents the "validated in dev → broken in prod" loop. The workflow rules in there override anything below if there's a conflict.

## What this repo is

**Ordak Go** (handle: `ordak-go`, repo: `ordakGov2`) — a Shopify embedded app providing delivery and pickup scheduling. Customers pick a delivery date or pickup window in the cart, and that choice is locked through to checkout via a Carrier Service callback, a Delivery Customization Function, and a Cart Validation Function. The app is published by **P&T Group**. Outbound webhooks let merchants forward order/scheduling events to any external system (ERP, routing, warehouse, fulfillment) — destinations are merchant-configurable in the admin and are off by default.

Goal hierarchy:
1. **v1**: ship a stable App Store listing (unlisted public) and complete first installs
2. **v2**: graduate to a fully public App Store listing

## Stack (post-2026-05 upgrade)

- Remix 2.17, React 18, Vite 5
- Polaris 13.9.5, App Bridge React 4.2
- `@shopify/shopify-app-remix` 4.2 (token-exchange auth, embedded)
- `@shopify/shopify-api` 13, API version `ApiVersion.April26`
- Prisma 6.19.3 + PostgreSQL on Supabase (project ref `zqwkqyviacvpjggesdbz`)
- Node ≥ 20.10
- Shopify CLI 3.94 (local `@shopify/cli` devDep)

## Branches

- `main` — production-ready, stable
- `Dev` — integration; daily work and feature merges land here
- Feature branches: `feat/<thing>` off `Dev`, PR back into `Dev`
- PRs from `Dev` → `main` only after dev-store testing

A **PreToolUse hook blocks Write/Edit while on `main`** (intentional safety rail). Always work from `Dev` or a feature branch.

## Boot it locally

**One command, everything hot-reloads:**

```bash
npm run dev   # alias: npm run dev:up
```

Runs `scripts/dev-up.sh` which orchestrates three processes:

1. **`cloudflared tunnel run ordak-go-dev`** (background) — stable named tunnel, routes `https://dev.ordak.vip` → `localhost:5173`.
2. **Vite/Remix dev server** (background) — serves the embedded admin on `localhost:5173` with HMR.
3. **`shopify app dev`** (foreground) — pushes Development previews of every extension (cart-block, delivery-rate-filter, cart-validation) to `ordakgo-v3` and hot-reloads on save. Also keeps Partners config in sync.

Edit `app/routes/*` → save → admin hot-reloads. Edit `extensions/_cart-block-src/*` → save → cart-block reloads on the storefront. **No `shopify app deploy`, no `shopify app release` for iteration.** Releases are for App Store distribution, not for checking your own work.

Ctrl-C in the foreground process exits everything cleanly via the script's signal trap.

The iteration loop matches every other ordak project: **edit → save → see it on `ordakgo-v3` → commit → push → PR.**

### Why a named tunnel and not the CLI's quick tunnel?

Vite has to be reachable by Shopify (the embedded admin runs in an iframe served from a public HTTPS URL). The CLI's quick tunnel works only for the duration of `shopify app dev`; the named tunnel `dev.ordak.vip` is permanent, so the toml's URLs stay stable across restarts and the Partners config doesn't need to be re-pushed every session.

The toml's URLs (`application_url`, `redirect_urls`, `app_proxy.url`) are pinned to `https://dev.ordak.vip`. For App Store production deploys, flip them to `https://ordak-go.vercel.app` and run `npm run deploy:prod` — that's a one-time pre-launch action, not the iteration loop.

## What's next

The current plan and phase ordering live in [`docs/PLAN.md`](docs/PLAN.md) and [`docs/PRE_PHASE_2_UX_FIXES.md`](docs/PRE_PHASE_2_UX_FIXES.md). High-level:
- ✅ **Phase A–C.5** (PRs #39–#42, merged 2026-05-02/03) — cart-block, Carrier Service, order pipeline, Delivery Customization Function. Tag `v0.5.0-pickup-checkout-locked` is the recoverable baseline.
- ✅ **Phase D — 10 steps** (PRs #53–#65, merged 2026-05-04/05) — schema migration (D1), per-Location admin shell (D2), per-Zone delivery slot admin (D3 headline), Carrier Service rewrite (D4), Cart Validation Function + cart-block UX cleanup (D5), wizard pipes through (D6), settings restructure (D7), orders calendar (D8), webhook destinations (D9), admin reschedule finalized (D10).
- ✅ **Per-location pickup hours admin** (PR #95, merged 2026-05-07) — closes the gap Phase D missed. New "Pickup hours" tab on `/app/locations/:id` with shared `SlotsEditor` component. Setup wizard auto-detours through pickup-hours when `supportsPickup` is checked. Page-level + dashboard misconfig warnings when pickup is enabled but has no hours. See `memory/pickup_admin_per_location.md` for the architecture reference.
- ✅ **Phase 1 verification gate CLOSED** (2026-05-07) — real test orders end-to-end on `ordakgo-v3`:
  - #1001 delivery — slot 2026-05-15 11:00, `slot.booked=1`, OrderLink + EventLog rows present.
  - #1002 pickup — slot 2026-05-07 09:00 at Bannos HQ, `slot.booked=1`, `order.linked` + `order.shopify_writes_attempted` (ok=true) events fired.
- ✅ **`ordak-go-38`** released globally (cart-block + delivery-rate-filter + cart-validation), bundling the pickup-mode wording fix.
- ✅ **Phase 1.5.A — Per-slot cutoff** (PR #110, main 2026-05-08). `cutoffOffsetMinutes` on `Slot` + `SlotTemplate`, Cutoff column in slot editor.
- ✅ **Phase 1.5.D — Drop `/app/rules` + theme-editor deep link** (PR #112, main 2026-05-08). Cart-validation install row replaced; new `hide_express_buttons` toggle on cart-scheduler-embed (default ON). `ordak-go-42` released.
- ✅ **Phase 1.5.B — Per-Location blackout dates** (PR #118, main 2026-05-09). `Location.blackoutDates DateTime[]` migration; calendar editor; filter wired into 4 sites (storefront recs, carrier-service, admin reschedule loader+action, update-schedule action).
- ✅ **Phase 1.5.C — Per-Location lead time** (PR #119, main 2026-05-09). `Location.leadTimeHours` + `leadTimeDays` migration; prep-time form with live preview; same 4-site filter wiring.
- ✅ **Polaris-alignment refactor** (PRs #113-#117 + #120-#121, main 2026-05-09). Settings hub + AnnotatedSection + SaveBar + App Bridge toast + microcopy + nested routes for `zones.$id` and `locations.$id`. Spec §10 "no inline saves" FULL PASS.
- ✅ **App Store audit fixes** (PR #122, main 2026-05-09). GDPR redact retry storm closed; cross-shop OrderLink leak in recommendations.slots scoped.
- ✅ **Cart-block fixes** (PRs #123-#124, `ordak-go-43` released 2026-05-09). First-open race fix (widget renders on first cart drawer open) + surface auto-detection (cart drawer vs cart page diagnostics drive the dashboard).
- ✅ **Dev → main sync** (PR #125, merge commit `3fd789f`, 2026-05-09). v1 codebase complete on main. Vercel prod auto-deployed.
- ✅ **Brand alignment** (PR #128, merge commit `f5a6418`, 2026-05-09). Cart-block default accent swapped from Google blue to Ordak orange (`#EB5E14`); dashboard welcome card now shows the orange app-icon tile next to the heading. `ordak-go-44` released. Partners app icon (1200×1200) uploaded by user.
- ✅ **Phase 2 prep — code-side** (PR #129, merge commit `6125ff5`, 2026-05-09). Public ToS at `/policies/terms`; per shop+IP rate limiting on all 6 `apps.proxy.*` routes (default 60 req/min, configurable via `RATE_LIMIT_MAX_PER_MINUTE`); `PRIVACY_POLICY.md` placeholder emails replaced with `panos@bannos.com.au`; listing copy drafted at `docs/APP_STORE_LISTING.md`; reviewer instructions drafted at `docs/APP_STORE_REVIEWER_INSTRUCTIONS.md`; `npm audit` analysed and documented (advisories all blocked by `@vercel/remix@2.16.7` peer dep on Remix 2.16.7 — vulnerable code paths are dead in our runtime).
- ⏳ **Phase 2 — manual asset capture remaining**. 3–6 screenshots @ 1600×900, 60–90s demo screencast, Partners "Free" pricing config, carrier-service uninstall/reinstall smoke on `ordakgo-v3`. All code-side items shipped. See `SHOPIFY_APP_STORE_CHECKLIST.md` and `docs/APP_STORE_LISTING.md`.
- ⏳ **Phase 3** — reviewer-experience hardening: carrier-service uninstall/reinstall test on `ordakgo-v3`, final pre-submission smoke.
- ⏳ **Phase 4–6** — submit unlisted, address review feedback, install on Bannos + Flour Lane via the unlisted listing's direct link post-approval.

## Pre-launch loop — push to Dev, verify in admin (no main merge required)

While the app has zero production installs, `shopify.app.ordak-go.toml` pins `application_url` + `app_proxy.url` to the **Dev branch** Vercel deploy URL (`ordak-go-git-dev-bannos-and-flour-lane.vercel.app`). This means:

> Push to `Dev` → Vercel auto-deploys in ~30–60s → reload the Shopify admin → Apps → Ordak Go on `ordakgo-v3` → the change is live.

**No `Dev → main` merge is required to verify a change in the embedded admin.** Merge to `main` only when the feature is solid and you want it on the stable line. The Dev URL routing is the development surface; the prod URL (`ordak-go.vercel.app`) is the "stable" line we ship from at App Store listing time. Full ritual + when-to-flip in [`docs/WORKFLOW.md`](docs/WORKFLOW.md) § "The proven pre-launch loop."

## Key directories

- `app/routes/api.*` — internal APIs (eligibility, recommendations, order tagging, reschedule, telemetry)
- `app/routes/apps.proxy.*` — storefront-facing wrappers; all delegate to `appProxyAction()` in `app/utils/app-proxy.server.ts` which authenticates the Shopify proxy signature and pins `shopDomain` from session
- `app/routes/api.carrier-service.rates.tsx` — Carrier Service callback (Phase B)
- `app/routes/app.*` — Polaris admin pages (Locations, Zones, Rules, Orders, etc.)
- `app/routes/auth.*` — OAuth + login
- `app/routes/webhooks.*` — webhook handlers (orders/create + APP_UNINSTALLED + GDPR)
- `app/services/` — recommendation scoring, distance, metafield, **carrier-service** (Phase B)
- `app/utils/` — env validation, logger, Zod schemas, `app-proxy.server.ts` (proxy auth helper)
- `app/shopify.server.ts` — SDK config + afterAuth (Shop bootstrap + carrier service registration)
- `prisma/schema.prisma` — data model
- `prisma/migrations/` — applied to Supabase
- `extensions/cart-block/` — Phase A theme app extension (deployable: assets, blocks, locales, shopify.extension.toml)
- `extensions/_cart-block-src/` — TypeScript source + esbuild config; outputs to `../cart-block/assets/`
- `scripts/` — dev-up / dev-down / dev-logs / _lib (auto-plumbing dev loop)
- `docs/app/` — original spec docs (PRD, FEATURES, CHECKOUT_SPEC, RECOMMENDATIONS, DATA_MODEL, etc.)
- `public/*.js` — **legacy** storefront widgets, replaced by the cart-block; do not extend
- `shopify.app.ordak-go.toml` — linked Partners config

## Conventions

- TypeScript strict mode is on; `npx tsc --noEmit` should always be 0 errors
- Build verification: `npm run build` (Remix Vite build) before merging
- No mock data in tests; integration testing happens on the dev store `ordakgo-v3.myshopify.com`
- Prisma migrations: never push without explicit go-ahead; run `prisma migrate dev --name <thing>` and review the SQL before it lands
- For OrderLink queries that need shop scoping, traverse `slot.location.shopId` (OrderLink has no direct shopId)
- Schema fields: `shopifyDomain` not `domain`, `type` not `zoneType`/`ruleType`, `postalCode` not `postcode` for Location
- Admin forms use Remix's `<Form>` from `@remix-run/react`, **not** raw `<form method="post">`. Inside the embedded admin iframe a native form POST renders the redirect target's loader response as raw JSON instead of the React tree.

## Carrier Service contract — read before touching

Shopify's Carrier Service rate-request body does **not** include cart `note_attributes`. Only `origin / destination / items / currency`. The cart-block mirrors the cart attributes onto every line as `_`-prefixed properties (`_delivery_method`, `_slot_id`, `_was_recommended`), which DO appear at `rate.items[*].properties` in the carrier service callback AND at `order.line_items[*].properties` for the `webhooks.orders.create` handler. This contract is enforced as of Phase C (PR #41) — don't strip any of those three writes without checking Phase B + Phase C readers.

The carrier service is registered automatically in `afterAuth` and unregistered on `APP_UNINSTALLED`. The Shopify-assigned ID lives at `Shop.carrierServiceId`. Existing installs created BEFORE the afterAuth bootstrap landed need uninstall+reinstall to register — known limitation under token-exchange (which doesn't re-fire afterAuth). The `/app/install-carrier-service` convenience route is the manual workaround. Not a v1 blocker because each fresh App Store install runs `afterAuth` cleanly.

## Checkout-lock invariants (Phase C.5) — DO NOT regress

The "no checkout confusion" headline goal is delivered by combining:
1. The C.5 Function (`extensions/delivery-rate-filter/`) hiding rates that don't match the cart-stage choice.
2. The C.5 Function's input query reading EITHER `_delivery_method` line property OR cart-level `delivery_method` attribute (the cart-level fallback handles items added via theme quick-add or Shopify-API paths that bypass the cart-block).
3. Shopify-native Local Pickup OFF on every Location. **Never re-enable this.** It re-introduces the Ship/Pickup tab toggle at checkout, which lets the customer override the cart-stage choice and defeats the entire app. The user has explicitly rejected this path twice — see `memory/checkpoint_pickup_checkout_locked.md` and `memory/no_shopify_plus.md`.
4. Manual flat rates in the AU shipping zone with names that match the C.5 regex `\b(?:pick[-_ ]?up|in[-_ ]?store|click[-_ ]?(?:and|&)[-_ ]?collect|collect)\b` for pickup, anything else for delivery. Don't rename the rates away from those keywords.

If checkout filtering ever breaks, restore from `git tag v0.5.0-pickup-checkout-locked` (commit `ec9ed6b`, app version `ordak-go-18`) and follow the recovery checklist in `memory/checkpoint_pickup_checkout_locked.md`.

## What NOT to do (learned the hard way)

- **Don't pass `--tunnel-url=<url>:443` to `shopify app dev`** — the CLI interprets the URL's port as a LOCAL bind port and crashes with `EACCES: permission denied ::1:443` (port 443 requires root). Instead: pin the toml's URLs to the public tunnel (`https://dev.ordak.vip`), let the CLI read them from the toml, and let the CLI's internal proxy bind to a free high port. The named cloudflared tunnel makes `dev.ordak.vip` resolve to `localhost:5173`. This is what `npm run dev` already does — don't fight it.
- **Don't pass `--use-localhost` either** — it conflicts with the named-tunnel architecture and disables extension Development previews.
- **Don't recommend `shopify app deploy` + `shopify app release` to verify a local change.** Those commands distribute a numbered version to other stores. For your own iteration, `shopify app dev` already pushes a live Development preview to the dev store on every save.
- **Don't add `[web]` to the toml** — newer CLI rejects it as "Unsupported section."
- **Don't pin `apiVersion` to a hardcoded constant other than the current quarterly** (`ApiVersion.April26` today) — quarterly bumps happen via the rot-defense process in `memory/stack_rot_defense.md`.
- **Don't commit `.env`, `.env.save`, or any file with secrets** — gitignored, but be careful with editor backups.
- **Don't use `git add -A`** — be explicit about what's staged. Migrations folder, `.mcp.json`, and code changes are usually all you want.
- **Don't try to fix the legacy `public/*.js` widgets** — they're replaced wholesale by the cart-block extension. Time spent patching them is wasted.
- **Don't rebuild the cart-block source inside `extensions/cart-block/`** — that dir is the deployable bundle (Shopify CLI strict-enforces the four allowed subdirs). Source lives at `extensions/_cart-block-src/`; `npm run build:extensions` outputs to `../cart-block/assets/`.
- **Don't put TypeScript source in `extensions/cart-block/src/`** — Shopify CLI's theme-extension validator rejects any directory other than `assets/blocks/locales/snippets`.

## Where to find more context

- [`docs/PLAN.md`](docs/PLAN.md) — current 5-phase plan
- [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md) — exact boot procedure + tunnel setup
- `docs/app/PRD.md`, `FEATURES.md`, `CHECKOUT_SPEC.md`, `RECOMMENDATIONS.md` — original product spec
- `SHOPIFY_APP_STORE_CHECKLIST.md` — App Store submission requirements (Phase E)
- `IMPROVEMENTS.md` — historical record of pre-2026-05 cleanup (don't re-do these)

## Self-install convenience routes

When a shop misses an `afterAuth` bootstrap step (because token-exchange refresh doesn't re-fire `afterAuth`, or because a webhook topic was added after install), these routes let an admin self-heal by visiting them once:

- `/app/install-carrier-service` — re-registers the Carrier Service and updates `Shop.carrierServiceId`. Reports `active=false` if Shopify returns the registration as inactive.
- `/app/install-delivery-customization` — registers the C.5 Function as an active DeliveryCustomization (or re-enables an existing-but-disabled one).
- `/app/install-webhooks` — re-runs `shopify.registerWebhooks(session)` and surfaces per-topic `success`.
- `/app/setup-au-shipping` — programs the AU shipping zone with both flat rates.
- `/app/backfill-orders` — re-runs the orders/create handler against the most recent 10 orders that don't have an OrderLink. Useful after webhook subscriptions land late.

The user's per-project memory (auto-loaded) covers business context (Bannos/Flour Lane/ordak), the Partners app config, the integration target architecture, the named-tunnel infrastructure (UUID, credentials paths), and the working-style preferences (autonomy, no permission-asking inside an established workflow). Read those memory files for the "why" behind decisions.
