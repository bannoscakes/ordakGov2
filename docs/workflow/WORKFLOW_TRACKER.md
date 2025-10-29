# WORKFLOW_TRACKER (Live)

## Phase 0 — Repo & Policy
- [ ] Branches `main`, `dev` created
- [ ] Branch protections set (checks + review)
- [ ] CI wired: build/lint/test/bundle guard
- [ ] GitHub secrets for Test Store app
- [ ] All seeders/mocks removed

## Phase 1 — Skeleton App
- [ ] Scaffold app (Admin UI + embed; Checkout UI Extension if Plus)
- [ ] OAuth scopes minimal; health route
- [ ] Uninstall cleanup (remove webhooks/script tags)
- [ ] Error pages (401/403/429/5xx)

**Verify on Test store**
- [ ] Install app from Partner dashboard
- [ ] Admin loads clean; no console errors

## Phase 2 — Core MVP
- [ ] Delivery vs Pickup toggle (persist to attributes/metafields)
- [ ] Postcode eligibility rules (zones/ranges/lists, admin UI, clear messages)
- [ ] Calendar & time slots (cut-offs, lead times, blackout dates, capacity)
- [ ] Multi-location support
- [ ] Order tagging/metafields (date, slot, location)
- [ ] Admin setup wizard
- [ ] Optional reschedule (thank-you / account)
- [ ] Routing integration hooks (events/webhooks)

**Verify on Test store**
- [ ] Real orders: eligible/ineligible + pickup flows
- [ ] Slot caps enforced; tags/metafields present

## Phase 3 — Merchant UX
- [ ] Setup wizard (locations → zones → rules → widget styles)
- [ ] Calendar overview (due today, due this week)
- [ ] Diagnostics: "Why no slots?"
- [ ] Reschedule flow (thank-you page / customer account)

## Phase 3.5 — Recommendation Engine
- [ ] Data model: Add CustomerPreferences, RecommendationLog entities; extend Slot with recommendation_score
- [ ] Location coordinates storage for distance calculations
- [ ] Implement recommendation scoring algorithm (capacity, distance, popularity, personalization)
- [ ] API endpoints: POST /recommendations/slots, POST /recommendations/locations
- [ ] Recommendation events: recommendation.viewed, recommendation.selected webhooks
- [ ] Storefront widget: Display "Recommended" badges on optimal slots
- [ ] Admin settings page: Toggle recommendations, adjust weights, view adoption analytics
- [ ] Alternative time suggestions when preferred slots unavailable

**Verify on Test store**
- [ ] Recommended slots appear with badges and reasons
- [ ] Location recommendations sorted by distance
- [ ] Alternative suggestions shown for full slots
- [ ] Recommendation events logged correctly
- [ ] Analytics track adoption rates

## Phase 4 — Compliance & Performance
- [ ] App Store review checklist passed
- [ ] Web Vitals targets at 75th percentile (Admin UI & storefront widget)
- [ ] OAuth scopes audited; PII minimal
- [ ] Uninstall leaves store clean

## Phase 5 — Release
- [ ] PR `dev → main`
- [ ] Tag `vX.Y.Z`, release notes
- [ ] Post-release smoke test on Test store
- [ ] Update `SETUP_GUIDE.md` screenshots & FAQ

## Test Store Runbook
- [ ] Place delivery order with eligible postcode
- [ ] Attempt delivery order with ineligible postcode (expect block)
- [ ] Place pickup order (select location & time)
- [ ] Reschedule one order; cancel another; verify events
- [ ] Clean up: refund/cancel, archive orders, remove tags if needed

## PR Checklist (paste in PR)
- [ ] No mock data/fixtures
- [ ] Secrets via env only
- [ ] Unit tests updated
- [ ] Performance budget respected (bundle guard)
- [ ] Uninstall cleanup intact
- [ ] Test store steps executed & results attached (screens/video)
- [ ] Docs updated (`FEATURES.md` / `SETUP_GUIDE.md` / `CHANGELOG.md`)

## Rollback (no staging)
- [ ] Revert merge on `main` (GitHub UI)
- [ ] Retag patch version
- [ ] Communicate in release notes; restore previous app version if needed
