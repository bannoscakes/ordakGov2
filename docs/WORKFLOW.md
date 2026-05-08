# Workflow — how we work, how we verify, how we ship

This is the discipline framework for the ordakGov2 codebase. It exists because three days were lost to confidently-asserted "verified" claims that weren't, and "validated in dev → broken in prod" happened because Pipeline B (Shopify CDN extension bundles) is manual and separate from Pipeline A (Vercel admin app).

Read this top-to-bottom once per session. Reference as needed.

## Project status — **pre-production**

**Read this first.** The gates below describe what we'll need *once Bannos and Flour Lane install Ordak Go via the unlisted App Store listing*. We are nowhere near that today. Until that install exists:

- `ordakgo-v3` and `ordak-go-dev` are both **dev stores**. Bannos and Flour Lane do **not** have Ordak Go installed (verified 2026-05-06 from Partners screenshots).
- "Production" in this repo means the Vercel deploy at `ordak-go.vercel.app` — used only by `ordakgo-v3` (a dev store).
- **No merchants depend on uptime.** A regression on `main` affects exactly one dev store that the developer owns.

So while we are pre-production, the practical workflow collapses to the same shape as any early-stage Vercel + Supabase + GitHub project:

1. Branch off `Dev`.
2. Push the branch. Vercel auto-deploys a preview (Pipeline A) and/or `npx shopify app deploy + release` pushes a draft to the dev store (Pipeline B).
3. Look at the result on the dev store. Fix and re-push if it's broken.
4. Open a PR when you're happy.
5. Merge to `Dev`. Periodically promote `Dev → main`.
6. If something breaks post-merge, revert (one click).

**No pre-merge admin-form ceremony, no `shopify app dev` tunnel setup, no five-step verification audits unless the change is genuinely risky.** Unit tests + smoke scripts + diff review + a quick post-merge click-through is the gate. That's the same gate every other healthy pre-production project uses.

The detailed Pipeline A/B rules below kick in **only** once the App Store unlisted listing is approved and Bannos / Flour Lane install via the listing — at that point real merchants depend on uptime, and the gates ratchet up.

Reviewer note for future sessions: if you find yourself proposing a multi-step pre-merge verification harness for a small change in the current pre-production state, you're over-engineering. Default to merge-then-verify-on-prod with revert-as-undo.

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
4. **Draft deploy:** `npx shopify app deploy --no-release`. Creates a new version like `ordak-go-N` registered as a draft in Partners. The draft is the rollback target — having it archived lets you re-Release the previous version with one CLI command if the new bundle misbehaves.
5. **Release globally — DEFAULT:** `npx shopify app release --version=ordak-go-N`. Pushes the new bundle to Shopify CDN; all installed stores load it on next page render. **Do NOT default to the Partners-UI "Install on a development store" detour.** While ordakGov2 has zero production installs (Bannos and Flour Lane install `checkout-validation`, not this app), the only stores affected by Release are dev stores (`ordakgo-v3` + `ordak-go-dev`). CLI release is one command, faster than the Partners UI dance, and the rollback story is symmetric (`npx shopify app release --version=ordak-go-N-1` reverts).
6. **Real verification:** reload the `ordakgo-v3` storefront. Run a DevTools-console snippet that reads the actual DOM and asserts what we expect. Save the snippet output (paste into PR description). CDN propagation can lag 30–180s after Release — if the page still shows the old version path, hard-refresh or wait.
7. **Place a real test order** if the change is large enough to risk regressions in the order pipeline.
8. **Merge PR to `Dev` → promote `Dev → main`.** Pipeline A fires Vercel prod redeploy harmlessly; the bundle is already live on Shopify CDN from step 5.
9. **Roll-back plan:** `npx shopify app release --version=<prior>` (one CLI command) — or click Release on the prior version in Partners. Either works.

### When the default flips back to Partners-UI staged install

The CLI-Release default holds **only while ordakGov2 has zero production installs**. Once the app is App Store distributed and Bannos / Flour Lane install via the unlisted listing, **switch to the staged path:**

- `shopify app deploy --no-release` → draft only.
- Partners UI → "Install on a development store" → ordakgo-v3 only → verify on the dev store.
- THEN `shopify app release` → bundle goes live to all installs (production included).

The "Stop on any ambiguity that affects production" workflow rule is what triggers this flip. Until then, default = CLI Release.

### `shopify app dev` for iteration loops

For fast iterative work on extensions (5+ changes per hour), `shopify app dev` is even better than the deploy + release dance — pushes a "Development" preview that hot-reloads on file changes:

```bash
npx shopify app dev --store=ordakgo-v3.myshopify.com --tunnel-url=https://dev.ordak.vip:443 --no-update
```

Verified 2026-05-06 — the long-standing CLAUDE.md "EACCES" claim was wrong inheritance from a misdiagnosed earlier failure (PR #91 corrected). Run interactively (CLI prompts for the storefront password). See [`CLAUDE.md`](../CLAUDE.md) and [`DEV_SETUP.md`](DEV_SETUP.md).

Use `shopify app dev` for **iterative work**. Use `shopify app deploy + release` for **finished changes ready to ship**. Both verify on a real dev store.

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

## The verification gate — CLOSED 2026-05-07

`OrderLink` count for `ordakgo-v3` = **2**:
- **#1001 delivery** — slot 2026-05-15 11:00, `slot.booked=1`, OrderLink + EventLog rows present
- **#1002 pickup** — slot 2026-05-07 09:00 at Bannos HQ, `slot.booked=1`, `order.linked` + `order.shopify_writes_attempted` (ok=true) events fired

Foundation is verified. The cart → checkout → ORDERS_CREATE webhook → OrderLink + slot.booked + metafield + tags chain is now demonstrated end-to-end with both fulfillment paths.

### What "verified" means going forward

If a future incident requires re-verifying the foundation (e.g. after a major schema change), the evidence shape is:

1. SQL: `OrderLink` row exists for the test order on `ordakgo-v3`.
2. SQL: `Slot.booked` incremented by 1 (compare pre/post).
3. SQL: `EventLog` rows for `order.linked` + `order.shopify_writes_attempted` with `ok=true`.
4. Screenshot: Shopify Admin → Order detail → Metafields panel showing `ordak_scheduling`.
5. Screenshot: Shopify Admin → Order detail → Tags showing the expected tags.
6. Screenshots: cart-block preview total = checkout charged total.
7. Vercel log lines: carrier-callback POST + ORDERS_CREATE webhook POST.

Same evidence shape for one delivery order AND one pickup order = foundation gate closed.

## Path to App Store unlisted listing (post-foundation)

1. ✅ **Phase 0 — Clean baseline.** Done.
2. ✅ **Phase 1 — Real e2e order on ordakgo-v3.** Closed 2026-05-07 (orders #1001 delivery, #1002 pickup).
3. ⏳ **Phase 2 — App Store user-action assets.** Icon, screenshots, screencast, listing copy, demo store reviewer instructions, "Free" pricing. **This is the immediate next action.**
4. ⏳ **Phase 3 — Reviewer-experience hardening.** Carrier-service uninstall/reinstall test on `ordakgo-v3`. Final pre-submission smoke.
5. ⏳ **Phase 4 — Submit unlisted.**
6. ⏳ **Phase 5 — Address review feedback** iteratively.
7. ⏳ **Phase 6 — Post-approval install on Bannos and Flour Lane** via the unlisted listing's direct link. Replaces the existing `checkout-validation` app on Bannos.

Bannos and Flour Lane are explicitly out of scope until Phase 6.
