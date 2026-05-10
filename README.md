# ordakGov2 – Delivery & Pickup Scheduler App

Welcome to **ordakGov2**, a Shopify app that lets merchants provide their customers with flexible delivery and pickup options. The app adds a cart-page scheduling block that customers fill in before checkout; that choice is then locked through to checkout via a Carrier Service callback, a Delivery Customization Function, and a Cart Validation Function.

## What this app does

- Cart-page block (and, if the theme supports it, a cart drawer mirror) where customers pick a delivery date / time slot OR a pickup location and window before checkout.
- Postcode eligibility check + per-zone delivery rules.
- Calendar & time-slot picker respecting cut-offs, lead times, blackout dates, and capacity limits.
- Multi-location support with per-zone delivery rules and per-location pickup hours; orders are tagged with the selected date, slot, and location.
- Outbound webhooks (merchant-configurable, off by default) for order/scheduling events to external systems (ERP, routing, warehouse, fulfillment).
- Embedded admin: setup wizard, orders calendar, rescheduling, diagnostics surface.

## Getting started

```bash
npm install
npm run dev   # alias: npm run dev:up — starts cloudflared + Vite + shopify app dev together
```

`npm run dev` is the one-command iteration loop. Edit any file → save → see it live on the dev store (`ordakgo-v3.myshopify.com` admin or storefront). Ctrl-C tears down all three processes cleanly. **No `shopify app deploy` or `shopify app release` is needed for iteration** — those are only for App Store distribution.

Key docs:

- [`CLAUDE.md`](CLAUDE.md) — onboarding for Claude Code sessions (also useful for engineers new to the repo).
- [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md) — full local boot procedure + the one-time named-tunnel setup on a fresh machine.
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — two-pipeline (Vercel admin + Shopify CDN extensions) deploy model and the canonical iteration loop.
- [`docs/PLAN.md`](docs/PLAN.md) — current build plan and where we are.

## Documentation

The detailed design and process documentation lives in the [`docs`](docs) folder. Key documents include:

- `app/PRD.md` – Product Requirements Document.
- `app/FEATURES.md` – Feature specifications and scope.
- `app/DATA_MODEL.md` – Conceptual data model.
- `app/API_EVENTS.md` – API and event contract definitions.
- `app/CHECKOUT_SPEC.md` – Checkout & storefront extension spec.
- `app/RECOMMENDATIONS.md` – Recommendation engine spec.
- `app/SHOPIFY_COMPLIANCE.md` – App Store and Built for Shopify compliance checklist.
- `app/QA_TEST_PLAN.md` – End‑to‑end test matrix and quality plan.
- `app/SETUP_GUIDE.md` – Merchant setup instructions.
- Workflow docs in `docs/workflow` for contributor guidelines and project tracking.

## Development

This repository follows a **`main` / `Dev`** branch strategy. `main` is the production-ready line; `Dev` is the integration branch where daily work and feature merges land. Feature branches are taken off `Dev` and PR'd back into `Dev`. PRs from `Dev → main` happen only after dev-store testing.

A PreToolUse hook blocks Write/Edit while on `main` (intentional safety rail). Always work from `Dev` or a feature branch.

### Iteration loop (matches every other ordak project)

1. `npm run dev` — leave running in a foreground terminal.
2. Edit code under `app/` (Remix admin, hot-reloads via Vite) or `extensions/_cart-block-src/` (cart-block, hot-reloads via `shopify app dev`).
3. Save → see it live on `ordakgo-v3`.
4. `npx tsc --noEmit && npm run build` locally before committing.
5. Commit, push feature branch, open PR to `Dev`.

For App Store production deploys (separate workflow, NOT the iteration loop), see [`docs/WORKFLOW.md`](docs/WORKFLOW.md) § "Production deploys" and [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md) § "Production deploys".

## Contributing

1. Fork the repository or create a new feature branch off `Dev`.
2. Run `npm run dev` and validate on `ordakgo-v3` before committing.
3. `npx tsc --noEmit` + `npm test` must pass before opening a PR.
4. Submit a PR to `Dev` with a clear description of your changes.

Please note: this app does not use mock data or a staging environment. All tests are performed against an official Shopify test store (`ordakgo-v3.myshopify.com`).

---

This README provides an entry point for developers and collaborators. See the documentation for full details and context.
