#!/usr/bin/env node
/**
 * Measure latency of the Carrier Service rate callback over N iterations.
 *
 * Shopify marks a carrier service unhealthy after consecutive timeouts;
 * the documented timeout is 10s but in practice short timeouts cause
 * blank rate lists at checkout. App Store reviewers may click into
 * checkout multiple times — if a cold start coincides with their click,
 * they see no rates and reject. This script captures min/median/p95/max
 * to establish a baseline + detect regressions.
 *
 * Usage:
 *
 *   # Warm-state baseline (10 iterations, default)
 *   npm run latency:carrier -- \
 *     --shop=ordakgo-v3.myshopify.com \
 *     --zone-id=<delivery-zone-id> \
 *     --slot-id=<delivery-slot-id> \
 *     --postcode=2035 \
 *     --location-id=<location-id>
 *
 *   # Custom iteration count + per-call delay
 *   ... --iterations=20 --delay-ms=200
 *
 *   # Cold-start measurement: invoke once after a known idle period.
 *   # The first request after >15min idle hits a cold start. Run this
 *   # AFTER you've left the function alone for 15+ minutes.
 *   ... --iterations=1
 *
 * Override CARRIER_URL for local testing:
 *   CARRIER_URL=http://localhost:3000/api/carrier-service/rates ...
 *
 * Targets (from plan Task 1.6):
 *   - Warm p95: < 2s
 *   - Cold start: < 4s
 * Mitigations if exceeded: keep-warm cron, Fluid Compute (default on
 * Vercel Node.js since 2025), runtime: 'edge' if benchmarked better.
 */

function parseArgs(argv) {
  const args = { iterations: "10", "delay-ms": "0" };
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith("--")) {
      console.error(`FAIL: unexpected positional arg: ${raw}`);
      process.exit(1);
    }
    const eq = raw.indexOf("=");
    if (eq === -1) {
      console.error(`FAIL: flag missing =value: ${raw}`);
      process.exit(1);
    }
    args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function percentile(sortedNumbers, p) {
  if (sortedNumbers.length === 0) return NaN;
  if (sortedNumbers.length === 1) return sortedNumbers[0];
  // Linear interpolation between adjacent ranks.
  const rank = (p / 100) * (sortedNumbers.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedNumbers[lo];
  const frac = rank - lo;
  return sortedNumbers[lo] * (1 - frac) + sortedNumbers[hi] * frac;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.CARRIER_URL ?? "https://ordak-go.vercel.app/api/carrier-service/rates";
  const iterations = Number.parseInt(args.iterations, 10);
  const delayMs = Number.parseInt(args["delay-ms"], 10);

  if (!Number.isFinite(iterations) || iterations < 1) fail("--iterations must be >= 1");
  if (!Number.isFinite(delayMs) || delayMs < 0) fail("--delay-ms must be >= 0");

  const required = ["shop", "zone-id", "slot-id", "postcode", "location-id"];
  for (const key of required) {
    if (!args[key]) fail(`Missing required flag: --${key}=`);
  }

  const body = JSON.stringify({
    rate: {
      origin: { country: "AU", postal_code: "2038" },
      destination: { country: "AU", postal_code: args.postcode },
      items: [
        {
          name: "latency-test",
          quantity: 1,
          price: 1000,
          requires_shipping: true,
          properties: {
            _delivery_method: "delivery",
            _zone_id: args["zone-id"],
            _slot_id: args["slot-id"],
            _location_id: args["location-id"],
          },
        },
      ],
      currency: "AUD",
      locale: "en-AU",
    },
  });

  console.log(
    `Measuring ${iterations} iteration(s) against ${url}\n` +
      `delay between calls: ${delayMs}ms\n` +
      `(first iteration may be cold-start if function was idle >15min)\n`,
  );

  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": args.shop,
        },
        body,
      });
    } catch (err) {
      const dt = performance.now() - t0;
      console.log(
        `  [${String(i + 1).padStart(2)}/${iterations}] ERROR after ${dt.toFixed(0)}ms: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const dt = performance.now() - t0;
    if (res.status !== 200) {
      console.log(`  [${String(i + 1).padStart(2)}/${iterations}] ${dt.toFixed(0)}ms — HTTP ${res.status}`);
      continue;
    }
    samples.push(dt);
    console.log(`  [${String(i + 1).padStart(2)}/${iterations}] ${dt.toFixed(0)}ms`);
    if (delayMs > 0 && i + 1 < iterations) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (samples.length === 0) fail("No successful samples captured");

  const sorted = samples.slice().sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const mean = sorted.reduce((acc, n) => acc + n, 0) / sorted.length;

  console.log(`\n${samples.length} sample(s) successful out of ${iterations}`);
  console.log(`  min:    ${min.toFixed(0)}ms`);
  console.log(`  median: ${median.toFixed(0)}ms`);
  console.log(`  mean:   ${mean.toFixed(0)}ms`);
  console.log(`  p95:    ${p95.toFixed(0)}ms`);
  console.log(`  max:    ${max.toFixed(0)}ms  ${samples.length === 1 ? "(single sample — likely cold start)" : ""}`);

  // Warn-only thresholds — exit non-zero so CI can catch a regression
  // if this script ever runs in CI.
  const WARN_P95_MS = 2000;
  const WARN_COLD_START_MS = 4000;
  let warned = false;
  if (samples.length === 1 && samples[0] > WARN_COLD_START_MS) {
    console.warn(`\n⚠️  Cold start ${samples[0].toFixed(0)}ms > ${WARN_COLD_START_MS}ms threshold`);
    warned = true;
  } else if (samples.length > 1 && p95 > WARN_P95_MS) {
    console.warn(`\n⚠️  Warm p95 ${p95.toFixed(0)}ms > ${WARN_P95_MS}ms threshold`);
    warned = true;
  }
  if (warned) {
    console.warn(
      "Mitigations:\n" +
        "  - Verify Vercel Fluid Compute is enabled (default on Node.js since 2025)\n" +
        "  - Add a Vercel cron at /api/carrier-service/rates (HEAD-only) every 4-5min\n" +
        "  - Benchmark runtime: 'edge' alternative if Node cold-start is dominant",
    );
    process.exit(2);
  }
  console.log(`\nOK — within thresholds (warm p95 < ${WARN_P95_MS}ms)`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
