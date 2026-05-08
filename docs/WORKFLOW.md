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
3. **Phase 1.5 — Pre-Phase-2 UX + Wiring Fixes.** See [`PRE_PHASE_2_UX_FIXES.md`](PRE_PHASE_2_UX_FIXES.md). Four sequential PRs: 1.5.A → 1.5.D.
   - ✅ **1.5.A — Per-slot cutoff** shipped 2026-05-08 (PR #110 → `main`). `cutoffOffsetMinutes` on `Slot` + `SlotTemplate`, Cutoff column in slot editor (with content-key memoization + flex-wrap row layout that survives narrow card widths), `isSlotCutoffPassed()` helper, slot loader filter. Verified live on `ordakgo-v3`.
   - ⏳ **1.5.B — Blackout dates per Location** (next).
   - ⏳ **1.5.C — Lead time per Location.**
   - ⏳ **1.5.D — Drop `/app/rules`, replace cart-validation install row with theme-editor deep link, add `hide_express_buttons` setting to cart-scheduler-embed.**
4. ⏳ **Phase 2 — App Store user-action assets.** Icon, screenshots, screencast, listing copy, demo store reviewer instructions, "Free" pricing. Starts after 1.5.D merges.
5. ⏳ **Phase 3 — Reviewer-experience hardening.** Carrier-service uninstall/reinstall test on `ordakgo-v3`. Final pre-submission smoke.
6. ⏳ **Phase 4 — Submit unlisted.**
7. ⏳ **Phase 5 — Address review feedback** iteratively.
8. ⏳ **Phase 6 — Post-approval install on Bannos and Flour Lane** via the unlisted listing's direct link. Replaces the existing `checkout-validation` app on Bannos.

Bannos and Flour Lane are explicitly out of scope until Phase 6.

## The proven pre-launch loop — push to Dev, verify in embedded admin (no merge required)

Verified 2026-05-08 across the 17-commit Phase 1.5.A iteration. Until ordakGov2 has production installs, the embedded admin in `ordakgo-v3` loads the Remix app from the **Dev branch** Vercel deploy URL — not from `main`. This is the entire pre-launch development loop:

1. Branch off `Dev`, or commit straight to `Dev` for small fixes (the `main`-edit-block hook in `~/.claude/settings.json` only blocks `main`).
2. `npx tsc --noEmit && npm run build` locally.
3. Push.
4. Vercel auto-deploys the Dev branch URL `ordak-go-git-dev-bannos-and-flour-lane.vercel.app` in ~30–60s. Watch for `READY` state via `gh` or the Vercel API.
5. Reload the Shopify admin → Apps → Ordak Go on `ordakgo-v3` → the new code is live.
6. Verify visually (or via DOM snapshot through `chrome-devtools-mcp` if needed).
7. Once the feature is solid, PR `Dev → main` to land it on the stable line.

`shopify.app.ordak-go.toml` pins both `application_url` and `app_proxy.url` to the Dev branch URL while we're pre-launch:

```
application_url = "https://ordak-go-git-dev-bannos-and-flour-lane.vercel.app/"
[auth] redirect_urls = ["https://ordak-go-git-dev-bannos-and-flour-lane.vercel.app/api/auth"]
[app_proxy] url = "https://ordak-go-git-dev-bannos-and-flour-lane.vercel.app/apps/proxy"
```

**Flip these URLs back to `ordak-go.vercel.app` (production) only at App Store listing time**, when Bannos and Flour Lane install via the unlisted listing. Until then, Dev branch routing IS the canonical pre-launch surface.

This addresses the long-standing "validated in dev → broken in prod" risk by making "dev" and "the embedded admin merchants would see" the same surface during pre-launch development. There's no separate prod environment to drift away from yet.

### How 1.5.A actually shipped — concrete walkthrough

Useful as a template for 1.5.B–D. This is the operational sequence we ran on 2026-05-08, not the abstracted rules.

**Starting state:**
- `main` was clean; PR #106 (an earlier 1.5.A attempt) had been reverted via #108/#109 because it shipped with a broken row layout.
- Cutoff helper + schema migrations had been cherry-picked back onto `Dev`.
- `shopify.app.ordak-go.toml` already pinned Partners URLs to the Dev branch Vercel deploy (`1db2a77`).

**The iteration loop (repeated 17 times):**

1. **Edit** — change `app/components/SlotsEditor.tsx` (the column layout / number-input rendering).
2. **Local check** — `npx tsc --noEmit && npm run build` (build is ~200ms; tsc is ~3s).
3. **Commit straight to Dev** — for layout-iteration commits. The `main`-only edit-block hook means Dev edits go through. (For larger feature work, branch off `Dev` and PR back, but small fix commits are fine direct.)
4. **Push** — `git push origin Dev`.
5. **Wait for Vercel** — Vercel auto-deploys the Dev branch URL on every push. Poll the Vercel REST API until `state == READY` (deploy times ~30–45s):
   ```bash
   AUTH=~/Library/Application\ Support/com.vercel.cli/auth.json
   TOKEN=$(python3 -c "import json; print(json.load(open('$AUTH'))['token'])")
   for i in 1 2 3 4 5; do
     curl -s "https://api.vercel.com/v6/deployments?projectId=prj_47J3tVZhbUseigMm9gnqGNy7Gu36&teamId=team_Wr9Vn5crRLWwlOlMxcyTHFDJ&limit=1" \
       -H "Authorization: Bearer $TOKEN" \
       | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); dep=d['deployments'][0]; print(dep['state'], dep.get('meta',{}).get('githubCommitSha','?')[:8])"
     sleep 5
   done
   ```
   Match the SHA against `git rev-parse --short HEAD` to confirm the deploy is for the latest push.
6. **User reloads admin** — user reloads `ordakgo-v3` admin → Apps → Ordak Go → relevant page. The new code renders.
7. **Verify visually** — for layout work, the user shared screenshots showing the rendered card. For state/data work, `chrome-devtools-mcp` (`take_snapshot`, `evaluate_script`, `fill` by uid) lets us inspect across the cross-origin iframe boundary that blocks console capture. Cross-origin iframes silo console output, so don't rely on `mcp__plugin_chrome-devtools-mcp__list_console_messages` to read embedded admin logs — use the accessibility-tree snapshot or evaluate scripts inside the iframe by uid.
8. **Iterate or land** — if the screenshot showed clipping/wrong layout, repeat from step 1 with another fix. If it looked right, go to step 9.

**Landing the feature on `main`:**

9. **Open the PR** — `gh pr create --base main --head Dev --title "..." --body "..."`. Body lists the commits since the last `Dev → main` merge; clearly distinguishes "verified live on `ordakgo-v3`" from "code-review only" rows.
10. **Wait for CI** — `gh pr checks <num>`. Loop until no `pending` rows. Vercel and Supabase Preview integrations both report into the PR.
11. **Merge** — `gh pr merge <num> --merge` (preserve commit history; we use `--merge` not `--squash` because the iteration commits are diagnostic signal). `--delete-branch=false` because `Dev` is the long-lived integration branch.
12. **Wait for prod deploy** — same Vercel REST poll as step 5 but with `target=production`. Match SHA against the merge commit SHA.
13. **No further user-visible action.** Because the toml still routes the embedded admin at `ordakgo-v3` to the **Dev branch** URL, the prod deploy is a "stable line" event, not a "users see the change" event. They already saw it during step 7.

**Non-obvious findings that should not be re-discovered:**

- **Polaris responsive layout is counter-intuitive at narrow widths.** A `Page` with sectioned tabs (`/app/zones/$id`) renders the tabs as a left sidebar at wider viewports and stacked above the content at narrower viewports. **The wider the monitor, the narrower the content card** in the right column. A row that fits at 1280px viewport may clip at 1600px. The fix is `display: flex; flex-wrap: wrap` for any horizontal row inside the content card so action clusters wrap to a second line instead of clipping right.
- **Cross-origin iframe console silo.** The embedded Shopify admin runs the Remix app in a cross-origin iframe. Console output from that iframe does NOT surface to `mcp__plugin_chrome-devtools-mcp__list_console_messages`. Use `take_snapshot` (accessibility tree, works across origins) or `evaluate_script` targeted at the iframe by uid.
- **Programmatic input fill on cross-origin iframe inputs WORKS via uid.** Earlier sessions assumed it didn't. Verified 2026-05-08 — `mcp__plugin_chrome-devtools-mcp__fill { uid, value }` writes directly to the iframe's input.value and triggers React's controlled-input change pipeline correctly.
- **Remix revalidations clobber controlled-input state inside collection editors.** `useEffect(...)` on a parent-prop array re-fires on every save round-trip and resets `useState` to the parent value. Solution: derive a content key (a stable string of the meaningful fields) and depend on the key, not the array reference. See `app/components/SlotsEditor.tsx` lines ~117–154 for the pattern.
- **Hide native `<input type="number">` spinner arrows.** They eat ~25–30px on the right side of the input. Hiding them via scoped CSS frees the column to render 4-character values like `5.75` without clipping. See the `.ordak-slots-editor` scoped CSS in `SlotsEditor.tsx`.
- **Vercel SSO protection blocks preview URLs by default.** If a Dev branch preview returns 401, disable SSO via `PATCH /v9/projects/{id}` with `ssoProtection: null`. We did this on the project once; it should not re-enable.
- **Vercel env vars need explicit `target` scoping.** The Dev branch preview hit `FUNCTION_INVOCATION_FAILED` until we mirrored production env vars to `target: ['production', 'preview']` via the Vercel API. New env vars should be added with both targets.
