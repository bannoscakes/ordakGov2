# Ordak Go — Shopify App Store listing copy

Paste-ready copy for each Partners Dashboard listing field. Tone: practical, scheduling-focused, Australian English. Tested against the listing-fields checklist in `SHOPIFY_APP_STORE_CHECKLIST.md`.

---

## App name

```
Ordak Go
```

## Tagline / Subtitle (≤ 70 chars)

Pick one. The first is the recommended default — shorter is sharper in the App Store grid.

- **Recommended (44 chars):** `Local delivery and pickup scheduling, locked.`
- Alt 1 (52 chars): `Per-zone delivery and per-location pickup scheduling.`
- Alt 2 (50 chars): `Cart-stage scheduling that survives at checkout.`

## App introduction (one short paragraph, ~140 chars)

```
Let shoppers pick a delivery date or pickup window in the cart, then lock that choice into checkout so it can't be silently overridden.
```

## App details / Long description

```
Ordak Go adds delivery and pickup scheduling to your Shopify store — without the fragility that has historically plagued "local delivery" apps.

Customers choose a delivery date and time slot (or a pickup location and window) in the cart, before they reach checkout. Their choice carries through every step: rate calculation, the shipping options Shopify shows them, the order tag, and the order metafields your fulfillment team reads.

The choice is locked in two ways:

  • A Shopify Delivery Customization Function hides shipping rates that don't match the cart-stage decision — pickup customers never see delivery rates, and vice versa.
  • A Shopify Cart Validation Function blocks express checkout (Shop Pay, Apple Pay, Buy-it-now) when scheduling data is missing, so customers never skip the scheduling step.

Configure once, run with confidence:

  • Per-zone delivery — postcode rules, base price, lead time, blackout dates, per-day capacity, per-day cutoffs.
  • Per-location pickup — opening hours, capacity, lead time, blackout dates, per-slot cutoffs.
  • Slot templates — apply a weekly rhythm across all zones or one location, then override individual dates as needed.
  • Orders calendar — view the day's bookings grouped by date, location, and fulfillment type. Reschedule from the same surface the customer would have seen.
  • Outbound webhooks — forward order/scheduling events to your ERP, routing software, or warehouse system. Off by default, signed with a secret you rotate from Settings.
  • GDPR-compliant — handles all three Shopify privacy webhooks (data_request, customers/redact, shop/redact).

Built by the team that runs bannoscakes.com.au and flourlane.com.au — a real Australian bakery operation that needed scheduling that actually works on Shopify Basic, without a Plus upgrade. We use this app every day to ship hundreds of cakes a week.

Ordak Go is free during initial release.
```

## Key benefits (3 bullets, ~80 chars each — listing surfaces these prominently)

```
Lock the cart-stage choice into checkout — no Ship vs Pickup tab override.
```

```
Per-zone delivery + per-location pickup admin, with capacity and cutoffs.
```

```
GDPR-ready, no Plus upgrade required, free during initial release.
```

## Feature highlights (longer-form bullets — for the listing's "Features" panel)

```
Cart-stage scheduling drawer
Customers pick delivery date/time or pickup location/window before checkout.
Configurable accent colour, heading, and pickup instructions per theme.

Carrier-Calculated Shipping callback
Returns delivery rates per zone with optional per-slot premiums.

Delivery Customization Function
Filters checkout shipping options to match the cart-stage choice.

Cart Validation Function
Blocks express checkout when scheduling data is missing — no skipped steps.

Per-zone delivery admin
Postcode rules, base price, lead time (hours and days), blackout calendar,
per-day capacity, per-day cutoff times.

Per-location pickup admin
Opening hours by weekday, slot template editor, blackout calendar, lead time,
per-slot cutoffs, capacity per slot.

Orders calendar
Day-grouped order list with reschedule from the merchant side.

Setup wizard
Six guided steps from store info to first slot — surfaces what's missing
on every visit until the install is production-ready.

Outbound webhook destinations
Forward order/scheduling events to external systems. Off by default.
HMAC-signed payloads, secret rotation per destination.

Diagnostics
Built-in diagnostics surface (cart drawer detection, express buttons visible,
function activation state) for both merchants and reviewers.
```

## Search terms / SEO keywords (comma-separated, 10 max)

```
local delivery, pickup scheduling, delivery scheduler, click and collect, time slots, delivery date picker, postcode delivery, food delivery, bakery scheduling, cart scheduling
```

## App categories

Primary: **Shipping and delivery → Delivery customizations**
Secondary: **Store management → Scheduling**

## Pricing summary (for the listing footer)

```
Free
Free during initial release. We will give 30 days' notice via in-app banner
and email before introducing any paid tier.
```

## Demo store URL (for reviewers)

```
https://ordakgo-v3.myshopify.com
Storefront password: theuld
```

## Support

```
Email: panos@bannos.com.au
Privacy policy: https://ordak-go.vercel.app/policies/privacy
Terms of service: https://ordak-go.vercel.app/policies/terms
```

---

## Style notes (don't paste this section into the listing)

- **Don't say "optimization" or "recommendation engine."** Per `memory/feedback_app_is_scheduling_not_optimization.md`, the app is scheduling. The recommendation features still exist but they're not the headline; merchants want practical scheduling knobs.
- **Don't promise "boost conversion" or growth language.** Real merchants installing this app already know they have a delivery problem; they want it solved, not marketed at.
- **Reference points are Zapiet and Pickeasy.** When in doubt about wording, look at how those listings describe themselves and use plainer language.
- **AU English where it appears in long-form copy** (colour not color, optimise not optimize). The app interface itself uses Polaris/Shopify's en-US conventions because that's the platform standard.
