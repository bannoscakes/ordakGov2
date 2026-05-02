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

The Shopify CLI's `app dev` auto-orchestration **does not work** for this project — wasted an hour debugging in the original session. **Skip it; use the manual 3-terminal flow** in [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md). Each cloudflared restart needs Partners URL + `.env` updates + Vite restart.

## What's next

The current plan and phase ordering live in [`docs/PLAN.md`](docs/PLAN.md). High-level: cart-page theme app extension (Phase A) → Carrier Service (Phase B) → order pipeline verification (Phase C) → restore stubbed admin (Phase D) → App Store readiness (Phase E).

## Key directories

- `app/routes/api.*` — public APIs the storefront calls (eligibility, recommendations, order tagging, reschedule, telemetry)
- `app/routes/app.*` — Polaris admin pages
- `app/routes/auth.*` — OAuth + login
- `app/routes/webhooks.*` — webhook handlers (orders/create + GDPR)
- `app/services/` — recommendation scoring, distance, metafield (Shopify GraphQL)
- `app/utils/` — env validation, logger, Zod schemas
- `app/shopify.server.ts` — SDK config
- `prisma/schema.prisma` — data model
- `prisma/migrations/` — applied to Supabase
- `public/*.js` — **legacy** storefront widgets, scheduled to be replaced by a theme app extension (Phase A)
- `docs/app/` — original spec docs (PRD, FEATURES, CHECKOUT_SPEC, RECOMMENDATIONS, DATA_MODEL, etc.)
- `extensions/` — **doesn't exist yet**, will house the theme app extension (Phase A)
- `shopify.app.ordak-go.toml` — linked Partners config; `shopify.app.toml` (without suffix) was deleted

## Conventions

- TypeScript strict mode is on; `npx tsc --noEmit` should always be 0 errors
- Build verification: `npm run build` (Remix Vite build) before merging
- No mock data in tests; integration testing happens on the dev store `ordak-go-dev.myshopify.com`
- Prisma migrations: never push without explicit go-ahead; run `prisma migrate dev --name <thing>` and review the SQL before it lands
- For OrderLink queries that need shop scoping, traverse `slot.location.shopId` (OrderLink has no direct shopId)
- Schema fields: `shopifyDomain` not `domain`, `type` not `zoneType`/`ruleType`, `postalCode` not `postcode` for Location

## Two routes are stubbed (waiting for proper rebuild)

- `app/routes/app.setup.tsx` — setup wizard placeholder pointing at granular admin pages
- `app/routes/app.orders.$orderId.reschedule.tsx` — admin reschedule placeholder

Don't accept these as "done" — they need real implementations as part of Phase D.

## What NOT to do (learned the hard way)

- **Don't suggest `shopify app dev --use-localhost` or `shopify app dev --tunnel-url <X>:443`** — they error or no-op. Use the 3-terminal flow.
- **Don't add `[web]` to the toml** — newer CLI rejects it as "Unsupported section."
- **Don't pin `apiVersion` to a hardcoded constant other than the current quarterly** (`ApiVersion.April26` today) — quarterly bumps happen via the rot-defense process in `memory/stack_rot_defense.md`.
- **Don't commit `.env`, `.env.save`, or any file with secrets** — gitignored, but be careful with editor backups.
- **Don't use `git add -A`** — be explicit about what's staged. Migrations folder, `.mcp.json`, and code changes are usually all you want.
- **Don't try to fix the legacy `public/*.js` widgets** — they're being replaced wholesale by the theme app extension in Phase A. Time spent patching them is wasted.

## Where to find more context

- [`docs/PLAN.md`](docs/PLAN.md) — current 5-phase plan
- [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md) — exact boot procedure
- `docs/app/PRD.md`, `FEATURES.md`, `CHECKOUT_SPEC.md`, `RECOMMENDATIONS.md` — original product spec
- `SHOPIFY_APP_STORE_CHECKLIST.md` — App Store submission requirements (Phase E)
- `IMPROVEMENTS.md` — historical record of pre-2026-05 cleanup (don't re-do these)

The user's per-project memory (auto-loaded) covers business context (Bannos/Flour Lane/ordak), the Partners app config, the integration target architecture, and the stack-rot defense plan — read those memory files for the "why" behind decisions.
