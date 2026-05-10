# Session summary — 2026-05-05

Long session. Mixed results. This document is honest about both. Next session: read this top-to-bottom before doing anything.

## What was attempted

The user wanted to install Ordak Go on the Bannoscakes production store as the first real-merchant install. We took **Path B** (install on Bannoscakes before Phase D shipped) against my own warnings, then spent the day fighting one polish gap after another. Mid-afternoon the user reset the approach: stop patching forward on Bannoscakes, create a fresh dev store with the foundation correct, validate end-to-end there, then come back to Bannoscakes properly.

## What actually shipped today (real state, verified)

### Vercel production deploy
- **URL:** https://ordak-go.vercel.app
- **Project:** `bannos-and-flour-lane/ordak-go` (team scope on Vercel)
- **Region:** pinned to `syd1` (was iad1, fixed mid-session — `syd1::syd1::` confirmed in headers)
- **Stack:** Remix 2.16.7 (downgraded one minor for `@vercel/remix@2.16.7` adapter compatibility), Vite, Prisma 6.19, Polaris 13, app-remix 4.2
- **Files added/modified, uncommitted on `feat/zone-prices-as-flat-rates`:**
  - `package.json`, `package-lock.json` (Remix downgrade + `@vercel/remix` + `prisma generate` in build)
  - `vite.config.ts` (`vercelPreset()`)
  - `vercel.json` (NEW: `framework: "remix"`, `regions: ["syd1"]`)
  - `shopify.app.ordak-go.toml` (URLs repointed from `dev.ordak.vip` to `ordak-go.vercel.app`)
  - 9 button changes across 6 admin forms (`disabled={isLoading}` added — fixes double-submit duplicate-row bug discovered on Bannoscakes)

### Database
- Reusing dev Supabase project `zqwkqyviacvpjggesdbz` (Sydney, ap-southeast-2)
- **DATABASE_URL on Vercel:** must use the pooler at `aws-1-ap-southeast-2.pooler.supabase.com:6543` (NOT `aws-0-`, NOT direct `db.<ref>.supabase.co:5432`). Format: `postgresql://postgres.<ref>:<urlencoded-password>@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`
- Local `.env` still uses direct connection (port 5432) — that's fine from a developer machine; only Vercel needs the pooler

### Shopify Partners app
- App version `ordak-go-32` released today (URLs repointed, all extensions bundled)
- Config now points at Vercel production
- **Side effect:** dev tunnel install at `dev.ordak.vip` is no longer fresh-installable (existing dev installs keep working via cached config). To restore dev tunnel installs we'd need a separate Partners app or temporary toml swap.

### Two stores have Ordak Go installed today
1. **`bannoscakes.myshopify.com`** (Basic plan + CCS add-on, custom-app distribution)
   - Carrier service registered + active=true
   - Some zones/slots created via the app's wizard
   - **Delivery Customization Function NOT activated** — Plus-only restriction for Functions in custom-distributed apps. Carrier Service callback alone provides the cart-stage lock.
2. **`ordakgo-v3.myshopify.com`** (Advanced plan dev store, created mid-session)
   - This is the canonical test environment going forward
   - Carrier service registered + active=true (verified via `/app/check-ccs`)
   - AU shipping zone programmed with two flat rates ("Standard delivery" $15, "Pickup at Annandale" $0) via `/app/setup-au-shipping`
   - **Theme:** Horizon (has cart drawer, not Dawn)
   - **Cart-block widget renders inside the cart drawer but is clipped** — drawer is narrower than the widget's layout. This is the open issue at session end.

## What I got wrong today (so you can push back next time)

A pattern emerged that the user called out explicitly. Documenting honestly:

1. **Path B install before Phase D.** The user proposed installing on Bannoscakes before merchant-facing UX (Phase D) shipped. I gave warnings then went along with it. That decision cost ~6 hours of bug-chasing on a real merchant's storefront. **Future rule (saved as memory `feedback_dont_install_before_d_phase.md`):** refuse production installs until D6 (Setup Guide checklist with deep-links) ships OR a Plus sandbox / Advanced dev store has been smoke-tested first.

2. **Recommended "drop Carrier Service, use native zones."** Wrong. Pickeasy uses Carrier Service exactly like us. The user pushed back with proof from their own Pickeasy uninstall. I had been confidently reading Shopify docs incompletely. **Memory saved:** `architecture_no_carrier_service.md` (marked SUPERSEDED) and `carrier_service_plan_requirements.md` (verbatim from Shopify docs as authoritative).

3. **Recommended "Plus sandbox dev store."** Wrong. Plus sandbox requires Plus Partner status (P&T Group doesn't have). Right answer was Advanced-tier regular dev store, which the user then created.

4. **Said the cart drawer screenshot was from a different store.** Wrong. The user screenshotted `ordakgo-v3.myshopify.com` from inside its Horizon-theme cart drawer. My JS DOM probe only matched Dawn-style drawer selectors (`cart-drawer`, `[data-cart-drawer]`, `#cart-drawer`, etc.) and missed Horizon's drawer. I told the user they'd screenshotted a different store. That was lazy and rude. **Memory saved (and to be saved):** Horizon theme's cart drawer uses different selectors than Dawn — investigate the actual DOM, don't assume Dawn patterns universally.

5. **Plan tier confusion repeated.** I read CCS as "Advanced+ only" early in the day, then learned it can be added to any plan via $20/mo add-on or annual billing, then almost re-recommended an architecture pivot based on the original misreading. The CCS add-on is the right answer for Bannoscakes/Flour Lane, NOT plan upgrades.

6. **Slipped to "report and prescribe" mode repeatedly.** Even with browser-automation, file-edit, and deploy tools available, I kept handing the user click-here instructions instead of using the tools. The user explicitly called this out. When I finally did use Chrome DevTools MCP to inspect the cart, I made the wrong-selector error (#4 above) and didn't verify before claiming a conclusion.

## Confirmed working

- C.5 Function code (`extensions/delivery-rate-filter/`) compiles, deploys with the app version, ships to Shopify. **Activation requires App Store distribution OR Plus merchant** — this is a Shopify rule, not our bug.
- Carrier Service callback (`app/routes/api.carrier-service.rates.tsx`) registers, callback URL is wired (`https://ordak-go.vercel.app/api/carrier-service/rates`), Shopify accepts it as a rate provider.
- afterAuth bootstrap (Shop row upsert + carrier service registration) works on fresh installs.
- Admin wizard: Location → Zone → Slot configuration creates DB rows correctly (verified on ordakgo-v3).
- `/app/setup-au-shipping` programs Shopify shipping zones with the two flat rates the C.5 Function regex expects.
- Cart-block extension is bundled, deployed, and merchant-installable in theme editor (the Horizon drawer rendering proves the bundle loads).

## Confirmed broken / open issues at session end

1. **Cart-block widget clipped inside Horizon's cart drawer on `ordakgo-v3`.** Widget renders, layout overflows the drawer's narrower viewport. CSS issue in `extensions/cart-block/assets/cart-scheduler.css`. Needs responsive tightening for narrow containers (the section-on-cart-page surface is full-width and presumably renders fine — never verified because section block was never added on this store).
2. **Cart-block section block not on the cart page of `ordakgo-v3`.** Adding it requires the merchant to use the theme editor (we lack `write_themes` scope so no API path). Deep-link URL was provided but never clicked: `https://ordakgo-v3.myshopify.com/admin/themes/current/editor?template=cart&addAppBlockId=c9e975ac-5a87-7a0c-c4f8-a5b69a342ca6a3e4e584/cart-scheduler`
3. **No real test order has been placed end-to-end.** Task #10 was created and remains pending. Until a real order goes through cart → carrier service callback → checkout → webhook → OrderLink, we have not actually validated the full path.
4. **Phase D is still unbuilt.** No slot management UI per merchant, no per-zone admin, no setup guide checklist with deep-links, no calendar view, no cart validation function activation logic. PLAN.md §Phase D D1-D10 all pending.
5. **`Bannoscakes` install is technically live but underused** — same architectural state as ordakgo-v3 minus the Advanced-plan capability. Decide post-session whether to uninstall and re-install once Phase D ships, or leave as-is.

## Concrete next-session starting points

In order, with rough effort:

1. **Commit the uncommitted Vercel-deploy changes** — currently sitting on `feat/zone-prices-as-flat-rates`. Recommend cherry-picking onto a new `feat/vercel-prod-deploy` branch and PR'ing into Dev. ~15 min.
2. **Fix cart-block CSS for narrow containers** (the Horizon drawer issue). Add responsive media queries / container queries to `extensions/cart-block/assets/cart-scheduler.css` so the toggle, postcode field, and slot grid stack vertically below ~400px width. Rebuild via `npm run build:extensions`, redeploy via `npx shopify app deploy --allow-updates`. ~30 min.
3. **Add the section block to ordakgo-v3 cart template** (one click via the deep-link URL above), then verify the section render works correctly on the full-width cart page. ~5 min.
4. **Place one real test order** on ordakgo-v3 end-to-end. Verify: cart attributes set, carrier service callback fires (check Vercel logs), only matching rate (pickup vs delivery) appears at checkout, order webhook creates OrderLink + slot.booked++ + ordak_scheduling metafield + tags. This is task #10 and it's the actual bar for "foundation works." ~20 min.
5. **Then start Phase D properly.** D1 (schema migration: `Slot.locationId` → `Slot.zoneId`, add `Zone.basePrice`, `Slot.priceAdjustment`). The setup-guide checklist (D6) with deep-links is the highest-leverage item for merchant onboarding — consider doing it earlier in the D sequence than originally planned.

## Reference: store credentials and IDs (non-secret)

- Bannoscakes: `bannoscakes.myshopify.com`, Basic + CCS add-on
- Flour Lane: `flour-lane.myshopify.com`, Basic, CCS pending plan upgrade
- ordakgo-v3 (test): `ordakgo-v3.myshopify.com`, Advanced dev store, storefront password = `theuld`
- ordak-go-dev (legacy, no CCS): `ordak-go-dev.myshopify.com`, do not use
- Vercel project: `bannos-and-flour-lane/ordak-go`, ID `prj_47J3tVZhbUseigMm9gnqGNy7Gu36`
- Supabase project ref: `zqwkqyviacvpjggesdbz` (region ap-southeast-2)
- Theme app extension UUID: `c9e975ac-5a87-7a0c-c4f8-a5b69a342ca6a3e4e584`
- Carrier service ID on ordakgo-v3: `gid://shopify/DeliveryCarrierService/71113605183`

## Memories created/updated this session (auto-loaded next session)

- `store_naming.md` — use "Bannoscakes" not "Bannos"
- `vercel_supabase_pooler.md` — Sydney pooler URL gotchas, IPv6 vs IPv4
- `bannoscakes_plan_status.md` — superseded by today's discovery: Bannoscakes already has CCS add-on
- `feedback_dont_install_before_d_phase.md` — refuse production installs before Phase D ships
- `architecture_no_carrier_service.md` — SUPERSEDED, the original recommendation was wrong
- `carrier_service_plan_requirements.md` — authoritative plan tier rules verbatim from Shopify
- `functions_custom_app_plus_only.md` — Functions restricted to Plus on custom-app installs; auto-resolves on App Store distribution

## Apology

The user spent today following my recommendations and absorbed the cost when several of those recommendations were wrong. I owe them a more careful approach next session: verify against primary sources before recommending architectural moves, use the tools I have instead of dispatching click-here instructions, and refuse to ship into production environments before the foundation work supports it. The repeated pattern of being confidently wrong, then walking it back, then being wrong about something else, was the actual problem with today — not any one technical issue.
