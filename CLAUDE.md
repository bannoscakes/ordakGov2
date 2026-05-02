# CLAUDE.md

Onboarding for Claude Code sessions in this repo. Read top-to-bottom once per session.

## What this repo is

**Ordak Go** (handle: `ordak-go`, repo: `ordakGov2`) — a Shopify embedded app providing delivery/pickup scheduling. Replaces a third-party "Local Delivery"–style app that broke on Shopify version changes and was costing the business orders. The app belongs to **P&T Group**, runs on the **`bannos`** and **`flour-lane`** production stores, and integrates with the existing **`bannoscakes-ordak-ui`** manufacturing system (separate Vite + Supabase repo at `/Users/panospanayi/projects/bannoscakes-ordak-ui`).

Goal hierarchy:
1. **v1**: install on Bannos + Flour Lane and replace the fragile third-party app
2. **v2**: submit to Shopify App Store

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

**One command:** `npm run dev:up` (and `dev:down` / `dev:logs`). Boots cloudflared + vite in the background, ~2 seconds per restart after the first run.

The app runs on a **stable named Cloudflare tunnel** at `https://dev.ordak.vip`. The tunnel hostname is permanent — `.env`, `shopify.app.ordak-go.toml`, and the Partners App URL are all pinned to it. No per-restart Partners-version churn. See [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md) for the one-time tunnel setup recipe (`cloudflared tunnel login` + `tunnel create` + `tunnel route dns`) — already done on this machine.

The Shopify CLI's `app dev` auto-orchestration **does not work** for this project — its auto-tunnel never starts and `--tunnel-url <X>:443` errors with EACCES. Don't retry it.

## What's next

The current plan and phase ordering live in [`docs/PLAN.md`](docs/PLAN.md). High-level:
- ✅ **Phase A** — cart-page theme app extension (PR #39 merged 2026-05-02)
- ✅ **Phase B** — Carrier Service register + rate callback (PR #40 merged 2026-05-02)
- 🟡 **Phase C** — order pipeline verification (next; folds in cart-block line-item-property writes)
- ⏳ **Phase D** — restore stubbed admin routes
- ⏳ **Phase E** — App Store readiness

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
- No mock data in tests; integration testing happens on the dev store `ordak-go-dev.myshopify.com`
- Prisma migrations: never push without explicit go-ahead; run `prisma migrate dev --name <thing>` and review the SQL before it lands
- For OrderLink queries that need shop scoping, traverse `slot.location.shopId` (OrderLink has no direct shopId)
- Schema fields: `shopifyDomain` not `domain`, `type` not `zoneType`/`ruleType`, `postalCode` not `postcode` for Location
- Admin forms use Remix's `<Form>` from `@remix-run/react`, **not** raw `<form method="post">`. Inside the embedded admin iframe a native form POST renders the redirect target's loader response as raw JSON instead of the React tree.

## Two routes are stubbed (waiting for proper rebuild)

- `app/routes/app.setup.tsx` — setup wizard placeholder pointing at granular admin pages
- `app/routes/app.orders.$orderId.reschedule.tsx` — admin reschedule placeholder

Don't accept these as "done" — they need real implementations as part of Phase D.

## Carrier Service contract — read before touching

Shopify's Carrier Service rate-request body does **not** include cart `note_attributes`. Only `origin / destination / items / currency`. The cart-block (Phase A scaffold; full property writes are Phase C) is expected to mirror the cart attributes onto every line as `_`-prefixed properties (`_delivery_method`, `_slot_id`, etc.), which DO appear at `rate.items[*].properties` in the carrier service callback. Document and enforce that contract — it's the seam between Phase A's UI selection and Phase B's checkout-lock.

The carrier service is registered automatically in `afterAuth` and unregistered on `APP_UNINSTALLED`. The Shopify-assigned ID lives at `Shop.carrierServiceId`. Existing installs created BEFORE the afterAuth bootstrap landed need uninstall+reinstall to register — known limitation under token-exchange (which doesn't re-fire afterAuth).

## What NOT to do (learned the hard way)

- **Don't suggest `shopify app dev --use-localhost` or `shopify app dev --tunnel-url <X>:443`** — they error or no-op. Use `npm run dev:up`.
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

The user's per-project memory (auto-loaded) covers business context (Bannos/Flour Lane/ordak), the Partners app config, the integration target architecture, the named-tunnel infrastructure (UUID, credentials paths), and the working-style preferences (autonomy, no permission-asking inside an established workflow). Read those memory files for the "why" behind decisions.
