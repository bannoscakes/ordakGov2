/**
 * Lead-time helper (Phase 1.5.C).
 *
 * A Location has optional `leadTimeHours` and `leadTimeDays`. Effective lead
 * time = `(days ?? 0) * 24 + (hours ?? 0)` hours. The slot loader and the
 * carrier-service callback drop any slot whose start moment is sooner than
 * `now + effectiveLeadTime`.
 *
 * Both fields default to null on existing rows (no lead time required, all
 * future slots eligible). The merchant edits in the per-location admin's
 * "Prep time & availability" section.
 */

import { wallClockInTzToUtcMs } from "./slot-cutoff.server";

type SlotForLeadTime = {
  date: Date;
  timeStart: string;
};

/**
 * Returns true if the slot starts sooner than `now + effective lead time`,
 * meaning the merchant's prep-time window can't be honored. Callers should
 * drop the slot from customer-facing lists / reject it at checkout.
 *
 * `tz` should be `slot.location.timezone` — same per-location source the
 * cutoff filter uses, since "lead time" is a wall-clock concept in the
 * location's local zone.
 *
 * Throws `RangeError` on bad IANA tz (matches the cutoff helper). Callers
 * should fail open per the same warn-and-keep-visible policy used for
 * cutoff: over-filtering on a single bad timezone empties the storefront
 * grid, which is worse UX than letting one too-soon slot slip through.
 */
export function isSlotWithinLeadTime(
  slot: SlotForLeadTime,
  now: Date,
  tz: string,
  leadTimeHours: number | null,
  leadTimeDays: number | null,
): boolean {
  const totalMinutes = effectiveLeadTimeMinutes(leadTimeHours, leadTimeDays);
  if (totalMinutes <= 0) return false;

  const [h, m] = parseHHMM(slot.timeStart);
  const y = slot.date.getUTCFullYear();
  const mo = slot.date.getUTCMonth();
  const d = slot.date.getUTCDate();

  const slotStartUtcMs = wallClockInTzToUtcMs({ y, mo, d, h, m }, tz);
  const earliestEligibleMs = now.getTime() + totalMinutes * 60_000;
  return slotStartUtcMs < earliestEligibleMs;
}

export function effectiveLeadTimeMinutes(
  leadTimeHours: number | null,
  leadTimeDays: number | null,
): number {
  const h = sanitizePositiveInt(leadTimeHours);
  const d = sanitizePositiveInt(leadTimeDays);
  return (d * 24 + h) * 60;
}

/**
 * Coerce a form-submitted string/number into a non-negative integer or null.
 * Used by the action handler when saving the per-location prep-time form.
 *
 *   "" / null / undefined → null
 *   non-negative integer-coercible → that integer
 *   anything else → null (treated as "no lead time")
 *
 * Range validation (e.g. cap at 30 days) lives in the route action — this
 * helper just normalizes the type.
 */
export function parseLeadTimeField(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return null;
}

function sanitizePositiveInt(v: number | null): number {
  if (v == null) return 0;
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function parseHHMM(s: string): [number, number] {
  const [hh, mm] = s.split(":").map((p) => parseInt(p, 10));
  return [Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0];
}
