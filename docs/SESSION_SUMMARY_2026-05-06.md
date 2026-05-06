# Session summary — end of session 2026-05-05/06

Continuation of `SESSION_SUMMARY_2026-05-05.md`. That file documented the Path-B-on-Bannoscakes mistakes; this file documents the recovery + Phase 5 push that landed.

## Production at `ordak-go.vercel.app`

- Cart-block writes `_zone_id` to line item properties (PR #66)
- Carrier service computes `zone.basePrice + slot.priceAdjustment` correctly (verified with smoke test)
- Setup Guide deep-links to cart template with click-by-click instructions (PRs #68, #70)
- `/app/setup-au-shipping` no longer creates the `$15` manual delivery rate (PR #72); delivery pricing handled exclusively by carrier service
- New `/app/cleanup-shipping-zones` admin route to remove existing manual `Standard delivery` rate from previously-installed shops (PR #72)
- Reduced OAuth scopes — 5, down from 7 — `write_orders, read_locations, write_delivery_customizations, write_shipping, write_validations` (PR #78). Dropped `write_products` and `write_merchant_managed_fulfillment_orders` after audit found zero API usage.
- GDPR `customers/data_request` real implementation: webhook logs structured `gdpr.data_request_received` audit line; admin route at `/app/data-requests` lets merchant search by customer email/id and download JSON export (PR #79)
- CUSTOMERS_REDACT phone-redaction copy-paste bug fixed — phone numbers were silently never redacted (pre-existing bug discovered and fixed during PR #79 review)
- Public privacy policy at `/policies/privacy` with `panos@bannos.com.au` contact (PR #80)
- Smoke-test + latency-measurement scripts shipped (`npm run smoke:carrier`, `npm run latency:carrier`) — PRs #73, #74

## App Store readiness — code-side complete

| Requirement | Status |
|---|---|
| Privacy policy with real contact | ✅ `/policies/privacy` (PR #80) |
| GDPR webhooks all working with real implementations | ✅ All three: `customers/data_request` (PR #79), `customers/redact` (fixed in #79), `shop/redact` (existing) |
| Least-privilege scopes | ✅ Reduced to 5 (PR #78) |
| GraphQL-only (no REST) | ✅ Audit clean — only match is the `graphql.json` URL (#77) |
| Carrier callback warm p95 < 2000ms | ✅ Baseline 182ms (#74) |
| OAuth + App Bridge embedded admin | ✅ Existing |
| Cart-block functional in target themes | ⚠️ Cart **page** section block confirmed working on Horizon (ordakgo-v3). Cart **drawer** embed placement is broken — see "Open bugs at end of session" below. |

## Open bugs at end of session

### Cart-block embed placement on Horizon cart drawer

**Symptom:** the cart-block embed (`.ordak-cart-scheduler-embed`) renders inside Shopify Horizon's cart drawer **nested inside the discount form** (`form.cart-discount__form`) instead of as a sibling above the Check out button. Visible to the merchant as the toggle / postcode row clipping past the drawer's right edge, "hiding behind Discount."

**Root cause (DOM-verified on live ordakgo-v3):** `findHostTarget()` in `extensions/_cart-block-src/src/index.tsx` uses the selector list `'button[name="checkout"], [name="checkout"], button[type="submit"]'`. `querySelector` returns the FIRST element matching ANY selector in DOM order, not by selector priority. In Horizon's drawer, the DOM order of submit buttons is:
1. `.ordak-postcode__row > button` (our own "Check" — type=submit) — once our widget mounts
2. `.cart-discount__form > button` (Discount "Apply" — type=submit)
3. `.cart__ctas > button[name="checkout"]` (real checkout)

The greedy `button[type="submit"]` fallback matches #1 (after re-render) or #2 (initial), and the embed gets nested under the wrong parent.

**Attempted fix + revert:** PR #82 (CSS container queries on the section block, irrelevant to the drawer) and PR #83 (drop `button[type="submit"]` from `findHostTarget`) were merged into Dev → main → released to Shopify CDN as `ordak-go-34`. Verification of `ordak-go-34` on the live drawer found `embed_in_html: false` — the embed disappeared from the DOM entirely post-deploy. Cause not yet root-caused (theme version-pin, block.settings.enabled state interaction with the new bundle, or runtime error in the new bundle preventing mount). Reverted via PR #85 (revert/cart-block-css-and-placement → main); released as `ordak-go-35`. Production is back to the pre-#82 state — embed renders, still in the wrong place.

**Why the pre-deploy "evidence" was misleading:** I proved the patched logic via DOM manipulation in the live page session (`parent.insertBefore(embed, ctas)`), which moved the embed node manually to the correct position. That tested the OUTCOME of the patched logic, not the LIFECYCLE of the patched code running in the bundle (mount, observer re-fires, etc.). **Lesson: DOM-manipulation evidence is not deploy-equivalent. The next attempt needs (a) a real test of the patched bundle running, e.g. via shopify dev tunnel pointed at ordakgo-v3 OR a synthetic-DOM unit test that exercises the full bundle lifecycle, AND (b) a vitest unit test for `findHostTarget` against a synthetic Horizon-shape DOM, before any deploy.**

Task #15 in the in-session task list tracks this.

## Outstanding for App Store submission — needs user action

| Task | What's needed | Who |
|---|---|---|
| 5.2 | Final support email (using `panos@bannos.com.au` placeholder) | User decision |
| 5.3 | App icon 1200×1200 PNG | User-supplied or designed |
| 5.4 | 3–6 screenshots @ 1600×900 | Capture from real demo store |
| 5.4b | Demo screencast video (60–90s, English narration) | Record + narrate |
| 5.5 | Demo store with seed data + reviewer instructions | Use ordakgo-v3 or new dedicated |
| 5.6 | Listing copy (intro/details/features) | Claude can draft, user approves |
| 5.6b | Set listing pricing as "Free" in Partners | Partners Dashboard |
| 5.8d | Carrier-service re-registration test (uninstall+reinstall) | Destructive — user kicks off |
| 5.9 | Stack-rot deferred items (Renovate config, quarterly cron) | Mostly post-approval |
| 5.10 | Final pre-submission smoke test on demo store | After all above |

## PRs landed this session

#64 Vercel deploy + double-submit guards
#65 PLAN.md sync
#66 Cart-block `_zone_id` line item property fix (root cause of cart-vs-checkout discrepancy)
#67 Dev → main promotion
#68 Setup Guide theme deep-link
#70 Drop broken `addAppBlockId` param after Horizon errored
#71 Dev → main promotion
#72 Drop $15 hardcode + add `/app/cleanup-shipping-zones`
#73 Carrier service smoke-test script
#74 Carrier callback latency script
#75 Dev → main promotion
#76 Hotfix package.json conflict markers
#77 SECURITY_AUDIT.md (npm audit + REST API audit)
#78 OAuth scope reduction
#79 GDPR `customers/data_request` real impl (App Store blocker fix) + 4 review fixes
#80 Privacy policy public route
#81 Dev → main promotion (Phase 5)

PR #69 was closed unmerged after discovery of broken deep-link.

#82 Cart-block CSS container queries for narrow surfaces — **MERGED then REVERTED via #85**
#83 Cart-block embed placement fix on Horizon (`findHostTarget` change) — **MERGED then REVERTED via #85**
#84 Dev → main promotion of #82 + #83 (released as `ordak-go-34`) — **MERGED then REVERTED**
#85 Revert PRs #82 + #83 — **MERGED**, released as `ordak-go-35`. Production restored to pre-#82 state.

## Verification baselines

These commands were verified passing at end of session and form the regression-guard surface:

```bash
# Cart-vs-checkout total parity (the original bug)
npm run smoke:carrier -- delivery \
  --shop=ordakgo-v3.myshopify.com \
  --zone-id=cmooyvw7z000iouvi9hfprzkf \
  --slot-id=cmorrcrex006rouoy3c0e2kvb \
  --postcode=2035 --location-id=cmoo1c3gt0002out7e0i5fjgo \
  --expected-cents=2200
# Expected: OK — Standard delivery $22.00

# Latency baseline (warm)
npm run latency:carrier -- --iterations=10 \
  --shop=ordakgo-v3.myshopify.com \
  --zone-id=cmooyvw7z000iouvi9hfprzkf \
  --slot-id=cmorrcrex006rouoy3c0e2kvb \
  --postcode=2035 --location-id=cmoo1c3gt0002out7e0i5fjgo
# Expected: warm p95 < 2000ms

# Privacy policy public access
curl -sI https://ordak-go.vercel.app/policies/privacy | head -3
# Expected: HTTP/2 200
```

## Next session entry point

Read this file. Then `git log --oneline -20 origin/main` to see the actual deployed state. Then either start the user-action Phase 5 items (with user driving) or open the listing-copy draft for review.
