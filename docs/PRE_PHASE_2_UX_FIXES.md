# Pre-Phase-2 UX + Wiring Fixes

Status: **1.5.A shipped to `main` 2026-05-08 (PR #110). 1.5.B–D pending.**

This document captures two structural problems found during Phase 1 closure that need to land **before** the App Store unlisted submission (Phase 2). Both relate to merchant onboarding UX — the bar isn't "the app technically works" but "a merchant can install it from the App Store and successfully configure it without our help."

Phase numbering after this doc lands:

1. ✅ Phase 1 — End-to-end order verification (closed 2026-05-07; orders #1001 + #1002 with full evidence on `ordakgo-v3`)
2. **Phase 1.5 — Merchant onboarding UX cleanup** *(this document)*
3. Phase 2 — App Store listing assets (icon, screenshots, screencast, listing copy, "Free" pricing)
4. Phase 3 — Reviewer-experience hardening
5. Phase 4 — Submit unlisted
6. Phase 5 — Address review feedback
7. Phase 6 — Post-approval install on Bannos + Flour Lane

---

## Finding 1 — `/app/rules` is the wrong abstraction, and its data is wired to nothing

### What's wrong (UX)

The current admin has a generic `/app/rules` surface with a single form that switches behavior based on a `type` field (`'cutoff' | 'lead_time' | 'blackout' | 'capacity'`). This forces the merchant to:

- Understand the abstract notion of "a rule"
- Pick a type from a dropdown
- Fill in *different* fields depending on the type
- Repeat for each rule
- Mentally connect "this rule applies to that location/zone"

Comparable third-party apps (Local Delivery Premium, Pickeasy, Zapiet) take the opposite approach — settings live where they're contextually relevant:

| Setting | Where it lives in third-party apps | Where it lives in ordakGov2 today |
|---|---|---|
| Cutoff per slot | Inline column in the timeslot row inside Location → Timeslots tab | Hidden inside `/app/rules` with `type='cutoff'` |
| Blackout dates | Dedicated calendar tab inside Location → Blackout dates | Hidden inside `/app/rules` with `type='blackout'` |
| Lead / prep time | "Prep time & availability" section inside Location | Hidden inside `/app/rules` with `type='lead_time'` |
| Slot capacity | Already on each slot row in the existing zone editor | ✓ already correct |

### What's wrong (runtime)

Searched `app/routes/api.* + app/routes/apps.proxy.* + app/services/ + extensions/`:

```
Hits for cutoffTime / leadTimeHours / leadTimeDays / blackoutDates: 0
```

The merchant configures cutoff "no same-day after 14:00" → row is written to Postgres → **nothing reads it**. The slot loader, eligibility API, carrier-service callback, C.5 Function, and cart-validation Function all ignore `Rule` rows entirely. The admin promises a feature that's wired to nothing.

### Proposed fix — four sequential PRs, smallest first

| PR | Change | Schema | Admin UI | Runtime |
|---|---|---|---|---|
| **A** | Cutoff per slot | Add `cutoffOffsetMinutes Int?` to `Slot` + `SlotTemplate` | Add **Cutoff** column to existing slot editor (per-zone for delivery, per-location for pickup) | Slot loader filters out slots where `now ≥ slot.start − cutoffOffsetMinutes` |
| **B** | Blackout dates per Location | Add `blackoutDates DateTime[]` to `Location` | New tab inside Location detail at `?section=blackout-dates` (calendar UI, click to toggle) | Slot loader excludes slots whose `date ∈ Location.blackoutDates` |
| **C** | Lead time per Location | Add `leadTimeHours Int?` + `leadTimeDays Int?` to `Location` | Form fields inside Location detail under a "Prep time & availability" section | Slot loader filters out slots before `now + leadTime` |
| **D** | Drop `/app/rules` | Migrate any existing Rule rows into the new fields, then drop `Rule` table (or keep only for `capacity` rules if used) | Remove `app.rules.*` routes; remove "Rules" pointer from Location detail nav | — |

Each PR is independently testable and shippable. `ordakgo-v3` has 0 Rule rows in Supabase (verified 2026-05-07) so no data-migration risk on the dev store. Bannos + Flour Lane don't have ordakGov2 installed so no production risk either.

### Risk register

- **Cutoff semantics — per-slot vs. per-day**: Local Delivery Premium does per-slot (each slot row has its own cutoff). Pickeasy does per-day. We're going per-slot for flexibility; the Cutoff column is hidden by default, only set when the merchant wants to gate a specific slot.
- **`/app/locations/$id` already has multiple sections**: per-location pickup-hours admin landed in PR #95, so the sectioned admin shell is in place. New tabs (blackout-dates) follow the same pattern.

---

## Finding 2 — "Activate cart validation" dashboard row is misleading

### What's wrong

The current setup-guide row reads:

> ⭕ **Activate cart validation** — Blocks Shop Pay / Apple Pay express checkout when scheduling is missing. **\[Install\]**

Clicking **Install** triggers `/app/install-cart-validation`, which runs the `validationCreate` GraphQL mutation. That mutation **fails** on ordakgo-v3 (and on every store with custom-app distribution that isn't on Plus) with the error:

```
CUSTOM_APP_FUNCTION_NOT_ELIGIBLE
"Custom app function is only eligible for shops on the Shopify Plus plan."
```

Verified empirically via direct admin GraphQL call on 2026-05-07. So merchants who download the app post-listing will click Install, see an error, and lose trust before they've completed onboarding.

### Better approach — replace Function-based with CSS-based via theme app embed

The `cart-scheduler-embed.liquid` we already have is a theme app embed. Adding CSS to it that hides express checkout buttons works on every plan, no Plus gate, no Function activation required.

#### Step 1 — Add hide-express-buttons setting to the embed schema

In `extensions/cart-block/blocks/cart-scheduler-embed.liquid`, add to the `settings` array:

```json
{
  "type": "checkbox",
  "id": "hide_express_buttons",
  "label": "Hide express checkout buttons (Buy It Now / Shop Pay / Apple Pay)",
  "info": "Recommended ON. Forces customers through the cart so the scheduling step can't be bypassed via express checkout. The data they pick is preserved into checkout regardless, so re-enabling the Shopify express buttons at the checkout page is safe.",
  "default": true
}
```

#### Step 2 — Inline CSS in the embed when toggle is on

```liquid
{%- if block.settings.hide_express_buttons -%}
  <style>
    /* Express checkout buttons that bypass the cart entirely.
       The cart-validation gate (Phase 1) only runs when the customer
       passes through the cart drawer/page; these buttons skip that. */
    .shopify-payment-button,
    .additional-checkout-buttons,
    [data-testid="dynamic-checkout-cart"],
    [data-shopify-buttoncontainer] {
      display: none !important;
    }
  </style>
{%- endif -%}
```

These selectors cover Buy It Now (product page), the dynamic checkout button group (cart page), and Shop Pay / Apple Pay / Google Pay button containers across modern Shopify themes.

#### Step 3 — Replace the dashboard row with a deep link to the theme editor

Drop the API-based install. Use:

```
https://{shop}.myshopify.com/admin/themes/current/editor?context=apps&activateAppId={extension_uuid}/cart-scheduler-embed
```

This opens the theme editor → **App Embeds** tab → `cart-scheduler-embed` is pre-selected and toggleable. One click → Save → embed is enabled with the hide-express-buttons CSS active.

`{extension_uuid}` is `c9e975ac-5a87-7a0c-c4f8-a5b69a342ca6a3e4e584` (per `docs/SESSION_SUMMARY_2026-05-05.md` and `extensions/cart-block/shopify.extension.toml`).

### Why this works (with the same guarantee as the Function approach)

| Surface | Pre-fix | Post-fix |
|---|---|---|
| Product page **Buy It Now** | Visible — bypasses cart entirely → no scheduling | Hidden by CSS — customer must add to cart and pass through scheduling |
| Cart drawer **Shop Pay / Apple Pay** | Visible — bypasses cart-block validation | Hidden by CSS — customer uses Check out → goes through cart-block validation |
| Top-of-checkout express buttons | Visible | Visible — but **doesn't matter**: by the time the customer reaches checkout, cart attributes (`_delivery_method`, `_slot_id`, `_zone_id`, `_location_id`) are already locked into the cart, so completing via express checkout still surfaces the scheduling info on the order |

### Keep the Shopify Function deployed but not user-visible

`extensions/cart-validation/` Function should stay in the codebase. Once the app is App-Store distributed (post-Phase 4), the `CUSTOM_APP_FUNCTION_NOT_ELIGIBLE` gate flips off and the Function activates automatically as a defense-in-depth backstop at `CHECKOUT_COMPLETION`. Until then, the CSS approach is the only working block, and we shouldn't expose a misleading "install" button for it.

### Detection — alert merchants when express buttons leak through

Add a passive detector in the cart-block:

```ts
function detectExpressButtons(): boolean {
  return !!document.querySelector(
    '.shopify-payment-button, .additional-checkout-buttons, [data-testid*="dynamic-checkout"]'
  );
}
```

When the cart-block mounts and finds express buttons visible (e.g., merchant didn't enable the hide setting, or theme uses an unrecognized selector), POST a small signal to a new `/api/storefront/diagnostics` endpoint. That sets `Shop.diagnosticsExpressButtonsVisible = true` (new column).

Dashboard then shows a warning row: *"Express checkout buttons are visible on your storefront. Enable the 'Hide express checkout buttons' setting in the cart-block app embed to block them."*

~30 lines of code total. Ships as part of Finding-2 PR work.

---

## Phase 1.5 PR sequence

Tracking the work as four sequential branches off `Dev`, smallest first. Each closes one verification gate per `docs/WORKFLOW.md`.

| # | Status | Branch | Scope | Touches |
|---|---|---|---|---|
| 1.5.A | **✅ Shipped 2026-05-08 (PR #110)** | merged into `main` via Dev | Schema + admin UI + slot loader | `prisma/` (`cutoffOffsetMinutes Int?` on `Slot` + `SlotTemplate`), `app/components/SlotsEditor.tsx`, `app/services/slot-cutoff.server.ts`, `app/routes/app.zones.$id.tsx`, location pickup-hours form, slot loaders. Verified live on `ordakgo-v3` admin |
| 1.5.B | ⏳ Next | `feat/blackout-dates-per-location` | Schema + admin tab + slot loader + express-button detection | `prisma/`, `app/routes/app.locations.$id.tsx` (new section), `app/routes/api.recommendations.slots.tsx`, `app/routes/api.storefront.diagnostics.tsx` (new), `extensions/_cart-block-src/src/` |
| 1.5.C | ⏳ Pending | `feat/leadtime-per-location` | Schema + form fields + slot loader | `prisma/`, `app/routes/app.locations.$id.tsx`, `app/routes/api.recommendations.slots.tsx` |
| 1.5.D | ⏳ Pending | `chore/replace-rules-and-cart-validation-install` | Drop `/app/rules` routes, replace dashboard row with deep-link to theme editor, add `hide_express_buttons` setting to cart-scheduler-embed, remove `/app/install-cart-validation` route | `app/routes/app.rules.*` (delete), `app/routes/app.install-cart-validation.tsx` (delete), `app/routes/app._index.tsx` (or wherever the setup guide rows live), `extensions/cart-block/blocks/cart-scheduler-embed.liquid` |

Verification per PR (per Pipeline B steps in `docs/WORKFLOW.md`):

1. Unit tests added/extended where applicable
2. `npx tsc --noEmit` clean
3. `npm run build` + `npm run build:extensions` clean
4. `npx shopify app deploy --no-release` for any extension change → release globally per the CLI-Release default
5. Real-world DOM/admin verification on `ordakgo-v3`
6. Evidence pasted into the PR description before merge

---

## What this changes in `next_steps_plan.md` memory

The "Immediate next step" pointer flips from "Phase 2 — App Store listing assets" to "Phase 1.5 — Merchant onboarding UX cleanup (this doc)." Phase 2 now starts after 1.5.D merges.

---

## 1.5.A retrospective — what we learned from the 17 commits

PR #110 shipped after 17 commits' worth of iteration. Useful signal for 1.5.B onwards:

- **The cutoff feature itself was small** (one schema field, one helper, one column in the editor, one loader filter). The expensive part was the admin-UI layout — Polaris `TextField` inside a flex/grid row clipped values at narrower card widths in non-obvious ways. **Lesson:** for any new admin column, build it inside the existing `SlotsEditor.tsx` flex-wrap row pattern (lines ~310–410) rather than inventing a new layout. The wrapping action cluster (Saved badge + ✕ Remove) is now the proven pattern.
- **PR #106 shipped to `main` with a broken layout, then was reverted** (#108/#109) before being redone on Dev. **Lesson:** don't merge to `main` until layout has been verified on the Dev preview URL with a screenshot. The Partners toml URL routing (below) makes this dead simple — no excuse to skip it.
- **Content-key memoization** in `SlotsEditor.tsx` (lines 117–154) prevents Remix revalidations from clobbering local state. Any future column added to the editor should be included in the `templatesByDayKey` join — otherwise typing into the new column will get reset every save round-trip.

## The proven pre-launch loop (verified 2026-05-08)

While ordakGov2 has zero production installs, `shopify.app.ordak-go.toml` points at the Dev branch Vercel deploy URL (`ordak-go-git-dev-bannos-and-flour-lane.vercel.app`). Result: push to `Dev` → Vercel auto-deploys in ~30s → reload the embedded admin in `ordakgo-v3` → see the change immediately. **No `Dev → main` merge required to verify a change in the embedded admin.**

The 1.5.B–D loop should be:

1. Branch off `Dev` (`feat/<thing>`)
2. Edit + `npx tsc --noEmit && npm run build` locally
3. Push the branch (or commit straight to Dev for small fixes; the branch hook only blocks `main`)
4. Wait for the Vercel "READY" deploy (≤60s)
5. Reload the `ordakgo-v3` admin and verify the change visually
6. PR to `Dev`, merge, then PR `Dev → main` once the feature is solid

**Flip toml URLs back to `ordak-go.vercel.app` only when the App Store unlisted listing lands and Bannos / Flour Lane install via the listing.** Until then, the Dev URL routing stays — it's the loop.
