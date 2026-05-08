/**
 * Phase 1.5.A smoke: prove the cutoff filter end-to-end against real
 * Supabase data, using the production helper + Prisma client.
 *
 * Pure HTTP testing against a Vercel preview is blocked by deployment
 * protection (401 without bypass token). This script exercises the
 * exact same code path the loader uses (`prisma.slot.findMany` +
 * `filter(isSlotCutoffPassed)`), minus the thin Remix HTTP wrapper.
 *
 * What it asserts:
 *   1. Schema column lives (round-trip a non-null cutoffOffsetMinutes).
 *   2. With cutoff = null, the slot loader's filter returns the slot.
 *   3. With cutoff = 99999 (~70 days), the filter excludes the slot.
 *   4. The carrier-service backstop also flags the cutoff'd slot as past.
 *
 * Run: `node scripts/smoke-cutoff-filter.mjs`
 *
 * Cleanup is in a finally block so a failed assertion still restores
 * the slot's original state.
 */

import { PrismaClient } from "@prisma/client";
import { isSlotCutoffPassed } from "../app/services/slot-cutoff.server.ts";

const prisma = new PrismaClient();

async function pickTestSlot() {
  // Pick the first future pickup slot at any Sydney location. Pickup is
  // simpler to reason about than delivery (no postcode→zone match needed).
  const slot = await prisma.slot.findFirst({
    where: {
      fulfillmentType: "pickup",
      isActive: true,
      date: { gte: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    },
    include: { location: { select: { id: true, name: true, timezone: true } } },
    orderBy: [{ date: "asc" }, { timeStart: "asc" }],
  });
  if (!slot) throw new Error("No future pickup slot found to test against");
  return slot;
}

async function runLoaderQuery(locationId, dateStart, dateEnd) {
  // Mirror the relevant filters from app/routes/api.recommendations.slots.tsx
  // lines 108-123. We don't need the recommendations scoring here — just
  // the candidate set + cutoff filter.
  const candidates = await prisma.slot.findMany({
    where: {
      date: { gte: dateStart, lte: dateEnd },
      fulfillmentType: "pickup",
      isActive: true,
      booked: { lt: prisma.slot.fields.capacity },
      locationId,
    },
    include: {
      location: { select: { id: true, name: true, timezone: true } },
    },
    orderBy: { date: "asc" },
  });
  const now = new Date();
  return candidates.filter((s) => {
    try {
      return !isSlotCutoffPassed(s, now, s.location.timezone);
    } catch {
      return true; // matches the route's tz-misconfig fallback
    }
  });
}

async function main() {
  const slot = await pickTestSlot();
  const original = slot.cutoffOffsetMinutes;
  const dateStart = new Date(slot.date);
  dateStart.setUTCHours(0, 0, 0, 0);
  const dateEnd = new Date(dateStart);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);

  console.log(
    `[smoke] target slot ${slot.id} @ ${slot.date.toISOString().slice(0, 10)} ${slot.timeStart} (${slot.location.name}, ${slot.location.timezone})`,
  );
  console.log(`[smoke] original cutoffOffsetMinutes = ${original}`);

  let failures = 0;
  try {
    // Round 1 — clear the cutoff, expect the slot to be present.
    await prisma.slot.update({
      where: { id: slot.id },
      data: { cutoffOffsetMinutes: null },
    });
    const present = await runLoaderQuery(slot.locationId, dateStart, dateEnd);
    const isPresent = present.some((s) => s.id === slot.id);
    console.log(
      `[smoke] round 1 (cutoff=null): slot present in filtered loader output → ${isPresent}`,
    );
    if (!isPresent) failures++;

    // Round 2 — set a far-past cutoff, expect the slot to be filtered out.
    // 99999 minutes ≈ 70 days; with a slot start <7 days away, cutoff is
    // unambiguously in the past in any plausible tz.
    await prisma.slot.update({
      where: { id: slot.id },
      data: { cutoffOffsetMinutes: 99999 },
    });
    const filtered = await runLoaderQuery(slot.locationId, dateStart, dateEnd);
    const isAbsent = !filtered.some((s) => s.id === slot.id);
    console.log(
      `[smoke] round 2 (cutoff=99999): slot absent from filtered loader output → ${isAbsent}`,
    );
    if (!isAbsent) failures++;

    // Round 3 — exercise the carrier-service backstop path (independent
    // helper call against the same row, with the same tz).
    const refreshed = await prisma.slot.findFirst({
      where: { id: slot.id },
      include: { location: { select: { timezone: true } } },
    });
    const cutoffPassed = isSlotCutoffPassed(refreshed, new Date(), refreshed.location.timezone);
    console.log(
      `[smoke] round 3 (carrier-service backstop): isSlotCutoffPassed → ${cutoffPassed}`,
    );
    if (!cutoffPassed) failures++;

    // Round 4 — confirm the filter handles tz misconfig by NOT throwing
    // (try/catch in callers). Force an invalid tz and expect "kept visible."
    const badTzCheck = (() => {
      try {
        return !isSlotCutoffPassed(refreshed, new Date(), "Not/A_Real_Tz");
      } catch {
        return true; // route fallback keeps slot visible
      }
    })();
    console.log(
      `[smoke] round 4 (bad-tz fallback in caller): slot kept visible → ${badTzCheck}`,
    );
    if (!badTzCheck) failures++;
  } finally {
    // Always restore — even if asserts fail, leave the dev DB clean.
    await prisma.slot.update({
      where: { id: slot.id },
      data: { cutoffOffsetMinutes: original },
    });
    console.log(`[smoke] restored cutoffOffsetMinutes = ${original}`);
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`[smoke] FAILED — ${failures} assertion(s) did not hold.`);
    process.exit(1);
  }
  console.log("[smoke] PASS — all 4 assertions hold.");
}

main().catch(async (err) => {
  console.error("[smoke] unexpected error:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
