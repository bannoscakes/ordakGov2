#!/usr/bin/env node
/**
 * Smoke test for the Ordak Go Carrier Service rate callback.
 *
 * Posts a synthetic Shopify-style rate request against the production
 * (or local) callback and asserts:
 *  - HTTP 200
 *  - Exactly one rate returned
 *  - service_name matches expected (delivery or pickup)
 *  - total_price (in cents) matches expected (zone.basePrice + slot.priceAdjustment)
 *
 * Designed to catch regressions in the cart-block → carrier-callback
 * contract introduced by PR #66 (the _zone_id line item property fix).
 *
 * Usage:
 *
 *   # Delivery happy path
 *   node scripts/smoke-carrier-service.mjs delivery \
 *     --shop=ordak-go-dev.myshopify.com \
 *     --zone-id=cmooyvw7z000iouvi9hfprzkf \
 *     --slot-id=cmorrcrex006rouoy3c0e2kvb \
 *     --postcode=2035 \
 *     --location-id=cmoo1c3gt0002out7e0i5fjgo \
 *     --expected-cents=2200
 *
 *   # Pickup happy path (no zone-id; slot-id refers to a pickup slot)
 *   node scripts/smoke-carrier-service.mjs pickup \
 *     --shop=ordak-go-dev.myshopify.com \
 *     --location-id=cmoo1c3gt0002out7e0i5fjgo \
 *     --slot-id=<pickup-slot-id> \
 *     --postcode=2038 \
 *     --expected-cents=0
 *
 * Override the callback URL with CARRIER_URL env var (default: production):
 *
 *   CARRIER_URL=http://localhost:3000/api/carrier-service/rates \
 *     node scripts/smoke-carrier-service.mjs delivery ...
 *
 * Stale-data caveat (read before debugging a failure):
 *
 * The callback returns `{ rates: [] }` (0 rates) for several
 * NON-regression reasons — postcode doesn't match any active zone,
 * pickup location is inactive, slot's zoneId/locationId/fulfillmentType
 * doesn't match the resolved zone (deliberate security guard). If this
 * smoke test fails with "Expected exactly 1 rate, got 0", FIRST verify
 * the zone-id, slot-id, and location-id flags still exist and are
 * mutually consistent in the target shop's DB before assuming a code
 * regression. The full callback response is printed before the
 * assertion fires so you can read its `rates` array (empty) plus the
 * Vercel logs for the request to see which guard tripped.
 */

import assert from "node:assert/strict";

function parseArgs(argv) {
  const [, , mode, ...rest] = argv;
  if (mode !== "delivery" && mode !== "pickup") {
    fail(
      `Usage: node scripts/smoke-carrier-service.mjs <delivery|pickup> --flag=value ...\nFirst positional arg must be "delivery" or "pickup", got: ${mode ?? "(missing)"}`,
    );
  }
  const args = { mode };
  for (const raw of rest) {
    if (!raw.startsWith("--")) {
      fail(`Unexpected positional arg: ${raw}`);
    }
    const eq = raw.indexOf("=");
    if (eq === -1) fail(`Flag missing =value: ${raw}`);
    const key = raw.slice(2, eq);
    const value = raw.slice(eq + 1);
    args[key] = value;
  }
  return args;
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function buildBody(args) {
  const properties = {
    _delivery_method: args.mode,
    _location_id: args["location-id"],
    _slot_id: args["slot-id"],
  };
  if (args.mode === "delivery" && args["zone-id"]) {
    properties._zone_id = args["zone-id"];
  }
  return {
    rate: {
      origin: { country: "AU", postal_code: "2038" },
      destination: { country: "AU", postal_code: args.postcode },
      items: [
        {
          name: "smoke-test-item",
          quantity: 1,
          price: 1000,
          requires_shipping: true,
          properties,
        },
      ],
      currency: "AUD",
      locale: "en-AU",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.CARRIER_URL ?? "https://ordak-go.vercel.app/api/carrier-service/rates";

  const required = ["shop", "slot-id", "postcode", "location-id", "expected-cents"];
  if (args.mode === "delivery") required.push("zone-id");
  for (const key of required) {
    if (!args[key]) fail(`Missing required flag: --${key}=`);
  }

  const expectedCents = Number(args["expected-cents"]);
  if (!Number.isFinite(expectedCents) || expectedCents < 0) {
    fail(`--expected-cents must be a non-negative integer, got: ${args["expected-cents"]}`);
  }

  const body = buildBody(args);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop-Domain": args.shop,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`Network error hitting ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const elapsedMs = Date.now() - t0;

  assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);

  const data = await res.json();
  console.log(JSON.stringify({ url, mode: args.mode, elapsedMs, response: data }, null, 2));

  if (data.rates?.length !== 1) {
    // 0 rates is the callback's deliberate signal for several
    // non-regression conditions (no zone matched, slot mismatch,
    // pickup location inactive). Log a hint pointing at the most
    // likely cause before failing — the full response is already
    // printed above, so the operator has both the response body and
    // this hint to triage with.
    const got = data.rates?.length ?? "(undefined)";
    console.error(
      `\nGot ${got} rate(s) when 1 was expected. Possible causes (NOT necessarily a code regression):\n` +
        `  - The --zone-id is no longer active or no longer covers --postcode\n` +
        `  - The --slot-id is deleted, deactivated, or moved to a different zone\n` +
        `  - The --location-id doesn't match the slot's location\n` +
        `  - Slot's fulfillmentType doesn't match the requested mode (${args.mode})\n` +
        `Verify with Prisma Studio against the target shop's DB before treating this as a code bug.\n`,
    );
    fail(`Expected exactly 1 rate, got ${got}`);
  }
  const rate = data.rates[0];

  if (args.mode === "delivery") {
    assert.match(rate.service_name, /standard delivery/i, `service_name should match Standard delivery, got "${rate.service_name}"`);
  } else {
    assert.match(rate.service_name, /pickup/i, `service_name should match Pickup, got "${rate.service_name}"`);
  }
  assert.equal(
    Number(rate.total_price),
    expectedCents,
    `Expected total_price=${expectedCents} cents, got ${rate.total_price}`,
  );

  console.log(
    `\nOK — ${args.mode} rate returned ${rate.service_name} at $${(expectedCents / 100).toFixed(2)} (${elapsedMs}ms)`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
