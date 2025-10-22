# WORKFLOW_TRACKER (Live)

## Phase 0 — Repo & Policy
- [ ] Branches `main`, `dev` created
- [ ] Branch protections set (checks + review)
- [ ] CI wired: build/lint/test/bundle guard
- [ ] GitHub secrets for Test Store app
- [ ] All seeders/mocks removed

## Phase 1 — Skeleton App
- [ ] Scaffold app (Admin UI + embed; Checkout UI Ext if Plus)
- [ ] OAuth scopes minimal; health route
- [ ] Uninstall cleanup (webhooks/script tags)
- [ ] Error pages (401/403/429/5xx)
**Verify on Test store**
- [ ] Install from Partner dashboard
- [ ] Admin loads clean; no console errors

## Phase 2 — Core MVP
- [ ] Delivery vs Pickup toggle (persist to attributes/metafields)
- [ ] Postcode eligibility (zones/rules, admin UI, clear messages)
- [ ] Calendar & time slots (cut-offs, lead times, blackout, capacity)
- [ ] Multi-location (rules per location, order tags with date/slot/location)
- [ ] Routing adapter (schedule/update/cancel events, signed, retries, idempotent)
**Verify on Test store**
- [ ] Real orders: eligible/ineligible + pickup flows
- [ ] Slot caps enforced; tags/metafields present

## Phase 3 — Merchant UX
- [ ] Setup wizard (locations→zones→rules→styles)
- [ ] Calendar overview
- [ ] Diagnostics: “Why no slots?”
- [ ] Optional reschedule (thank-you / account)

## Phase 4 — Compliance & Perf
- [ ] Shopify review checklist passed
- [ ] Web Vitals targets at p75 (Admin + widget)
- [ ] OAuth scopes audited; PII minimal
- [ ] Uninstall leaves store clean

## Phase 5 — Release
- [ ] PR dev→main
- [ ] Tag vX.Y.Z, notes
- [ ] Post-release smoke on Test store
- [ ] Update SETUP_GUIDE screenshots & FAQ

## Test Store Runbook
- [ ] Delivery order (eligible postcode)
- [ ] Blocked order (ineligible postcode)
- [ ] Pickup order (location + time)
- [ ] Reschedule & cancel; verify events
- [ ] Cleanup/refund/archive as needed

## PR Checklist (paste in PR)
- [ ] No mocks/fixtures
- [ ] Secrets via env only
- [ ] Unit tests updated
- [ ] Perf budget respected
- [ ] Uninstall cleanup intact
- [ ] Test store steps recorded (screens/video)
- [ ] Docs updated (FEATURES/SETUP/CHANGELOG)