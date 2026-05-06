# Workflow — how we work, how we verify, how we ship

This is the discipline framework for the ordakGov2 codebase. It exists because three days were lost to confidently-asserted "verified" claims that weren't, and "validated in dev → broken in prod" happened because Pipeline B (Shopify CDN extension bundles) is manual and separate from Pipeline A (Vercel admin app).

Read this top-to-bottom once per session. Reference as needed.

## Two deploy pipelines

The repo has two completely separate deploy paths. The workflow has to handle both, or "validated in dev → broken in prod" repeats.

### Pipeline A — Vercel (the Remix admin app)

- **Trigger:** every push to GitHub. Automatic.
- **PR open** → preview deploy at `ordak-go-git-<branch>.vercel.app`.
- **Merge to `main`** → production deploy at `ordak-go.vercel.app`.
- **Handles:** admin pages (`app/routes/app.*`), OAuth (`auth.*`), webhooks (`webhooks.*`), API routes (`api.*`), the carrier-service callback (`api.carrier-service.rates.tsx`), GDPR endpoints, the public privacy policy.
- **Speed:** ~30–60s after push.

### Pipeline B — Shopify CDN (the extension bundles)

- **Trigger:** **manual.** `npx shopify app deploy` from the repo root, or `npx shopify app deploy --no-release` for a draft.
- **Result:** creates a new app version (e.g. `ordak-go-36`) registered in Partners.
- **Then:** another manual step — click "Release" on the version in Partners (releases to all installs), OR install the draft on a specific dev store via "Install on a development store" (ships only to that store).
- **After Release:** the bundle propagates to Shopify's CDN; installed shops pick it up on next page load.
- **Handles:** `extensions/cart-block/` (the cart-page widget customers see), `extensions/delivery-rate-filter/` (the C.5 Function), `extensions/cart-validation/` (the D5 Function).
- **Speed:** not automatic. At least one manual click per deploy. Rollback is also one click (Release the previous version).

Pipeline A and Pipeline B are independent. A Vercel deploy does not deploy extensions. A `shopify app deploy` does not deploy the Remix app. **A change that touches both surfaces requires both deploys.**

## Verification rules — what counts as "verified"

| Claim | Counts? | Why |
|---|---|---|
| `npx tsc --noEmit` passes | No | Compilation, not behavior. |
| `npm run build` passes | No | Build success, not runtime correctness. |
| `grep` shows the right thing | No | Static analysis, not running code. |
| DOM manipulation in browser console reproduces the desired final state | No | Tests outcome shape, not the new code's lifecycle. This is the trap that produced the PR #82+#83 disaster. |
| Synthetic-DOM unit test (vitest + happy-dom) | Partial | Catches logic regressions; doesn't catch real-bundle bugs (mount, observer re-fires, CDN propagation, theme block reset). |
| Real bundle running on the real store + observing the result | **Yes** | The only thing that actually verifies extension code. |
| Real customer flow end-to-end through the affected surface | **Yes (gold)** | What App Store reviewers will do. |

**Anything claimed "verified" without a row from the bottom two has to be marked `code-review only` or `unit-test only` in the PR description.** Honest distinction prevents the lies from propagating across sessions.

## Workflow rules

| Rule | What it means |
|---|---|
| **Read before assert** | Every claim has a citation: file:line, SQL query result, log line, or curl output. If you can't cite it, say "unverified." |
| **Verified ≠ compiles** | See the verification rules table. |
| **Tools first, you last** | Available tools (Supabase MCP, `gh`, Shopify CLI, Chrome DevTools MCP, Read, Edit) get used. Push to web UI only for things genuinely unreachable (Partners UI clicks, logged-in storefront browser). |
| **PR description has an evidence column** | Each "verified" claim in the body has the evidence inline (log line, screenshot link, query result). Anything not so backed is marked. |
| **One question per ambiguity** | If two interpretations exist, ask once, then proceed. No silent guessing. |
| **Cross-session honesty** | SESSION_SUMMARY files separate "verified live" from "code-review only" with explicit columns. Lies get fixed when discovered, not propagated. |
| **Stop on any ambiguity that affects production** | Production = Bannos, Flour Lane, ordak-go.vercel.app, the live carrier-service registration. Don't act, ask. |
| **Hooks are friends** | The `main` edit-block hook (in `~/.claude/settings.json`) blocks Edit/Write while branch is `main`. Always work on a feature branch off `Dev`. |

## The cart-block deploy workflow specifically

This is the surface that bit us. Steps for any change to `extensions/_cart-block-src/` or `extensions/cart-block/`:

1. **Code change** on a feature branch off `Dev`.
2. **Synthetic-DOM unit tests** added or extended for any logic change. Vitest + happy-dom against a synthetic Horizon-shape DOM. CI runs these.
3. **Build the bundle:** `npm run build:extensions`. Confirm output in `extensions/cart-block/assets/cart-scheduler.js`.
4. **Draft deploy:** `npx shopify app deploy --no-release`. Creates a new version like `ordak-go-N` registered as a draft in Partners.
5. **Install the draft on `ordakgo-v3` only** via Partners → app version page → "Install on a development store" → pick `ordakgo-v3`. The real bundle now runs on the canonical test store; no other shop is affected.
6. **Real verification:** open the storefront cart drawer / cart page on `ordakgo-v3`. Run a DevTools-console snippet that reads the actual DOM and asserts what we expect. Save the snippet output (paste into PR description).
7. **Place a real test order** if the change is large enough to risk regressions in the order pipeline.
8. **Only after step 6 (and 7 if relevant) pass:** open PR → review → merge to `Dev` → merge to `main` (Pipeline A fires harmlessly).
9. **Release** the draft version in Partners (Pipeline B "Release" click). Bundle goes live on every installed shop.
10. **Roll-back plan:** if anything looks wrong on the live store, the previous version is one Partners "Release" click away. Document this in the PR description in advance.

Note: `shopify app dev` is documented in [`CLAUDE.md`](../CLAUDE.md) as not working for this project (auto-tunnel never starts; `--tunnel-url <X>:443` errors EACCES). The `--no-release` draft + dev-store install path is the verified alternative.

## The Remix-admin deploy workflow

Pipeline A is much simpler:

1. **Code change** on a feature branch off `Dev`.
2. **`npx tsc --noEmit && npm run build`** locally to catch obvious breakage.
3. **Push** → Vercel preview deploys automatically.
4. **Test the preview** — direct route URLs (e.g. `/policies/privacy`) work without auth. Embedded admin testing requires the toml's redirect URLs to match the preview URL, which they don't by default; for embedded routes, dev work is easier via `npm run dev:up` (the named tunnel) than via Vercel preview.
5. **Open PR to `Dev`.** CI runs typecheck + build.
6. **Merge to `Dev`** when green.
7. Periodically PR `Dev` → `main` for production. Vercel deploys prod automatically.

## What "the dev store" actually means now

| Store | Domain | Plan | Role |
|---|---|---|---|
| ordakgo-v3 | `ordakgo-v3.myshopify.com` | Advanced | **Canonical** dev store. Has CCS. Horizon theme. Storefront password `theuld`. All real verification happens here. |
| ordak-go-dev | `ordak-go-dev.myshopify.com` | Basic | **Retired.** No CCS. Kept around but no testing should happen here. |
| bannoscakes | `bannoscakes.myshopify.com` | Basic + CCS add-on | **Live production.** Out of scope until ordakGov2 is App Store approved. The current production app on Bannos is `checkout-validation` (separate repo); ordakGov2 has never been the production app on Bannos. |
| flour-lane | `flour-lane.myshopify.com` | Basic | **Live production.** Same scope rule as Bannos. |

## The open verification gate

Per [`docs/SESSION_SUMMARY_2026-05-05.md:84-85`](SESSION_SUMMARY_2026-05-05.md) and verified by Supabase query (`OrderLink` count = 0 for `ordakgo-v3` as of 2026-05-06), **no real customer order has been placed end-to-end on `ordakgo-v3`**. The Phase C code path was verified at the time on the retired `ordak-go-dev` store via orders #1007–#1013 (Supabase rows since deleted in the 2026-05-06 cleanup). The smoke test (`npm run smoke:carrier`, PR #73) verifies the carrier callback returns the right number when called with the right parameters; it does **not** verify the cart → checkout → ORDERS_CREATE webhook → OrderLink + slot.booked + metafield + tags chain.

Closing this gate is the foundation work that has to happen before any App Store submission. It produces the following evidence:

1. SQL: `OrderLink` row exists for the test order on `ordakgo-v3`.
2. SQL: `Slot.booked` incremented by 1 (compare pre/post).
3. Screenshot: Shopify Admin → Order detail → Metafields panel showing `ordak_scheduling`.
4. Screenshot: Shopify Admin → Order detail → Tags showing the expected tags.
5. Screenshots: cart-block preview total = checkout charged total.
6. Vercel log lines: carrier-callback POST + ORDERS_CREATE webhook POST.

Same evidence shape repeated for one delivery order and one pickup order = foundation gate closed.

## Path to App Store unlisted listing (post-foundation)

1. **Phase 0 — Clean baseline.** This file + the orders-#1007 lie fix in CLAUDE.md / PLAN.md = PR currently being prepared.
2. **Phase 1 — Real e2e order on ordakgo-v3.** Closes the verification gate above.
3. **Phase 2 — App Store user-action assets.** Icon, screenshots, screencast, listing copy, demo store reviewer instructions, "Free" pricing.
4. **Phase 3 — Reviewer-experience hardening.** Carrier-service uninstall/reinstall test on `ordakgo-v3`. Final pre-submission smoke.
5. **Phase 4 — Submit unlisted.**
6. **Phase 5 — Address review feedback** iteratively.
7. **Phase 6 — Post-approval install on Bannos and Flour Lane** via the unlisted listing's direct link. Replaces the existing `checkout-validation` app on Bannos.

Bannos and Flour Lane are explicitly out of scope until Phase 6.
