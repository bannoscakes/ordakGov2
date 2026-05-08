/**
 * Slot cutoff helper.
 *
 * A slot's `cutoffOffsetMinutes` (nullable, on both Slot and SlotTemplate)
 * means "stop accepting bookings this many minutes before slot start." Used
 * by the storefront slot loader and the carrier-service callback to gate
 * checkout when a customer holds the cart open past the cutoff.
 *
 * The slot's `date + timeStart` is shop-local wall clock — `slot.date` is
 * stored as UTC midnight on the calendar date the merchant intended in shop
 * timezone, and `timeStart` is "HH:MM" wall clock. To compare against
 * `now = new Date()` (real UTC), we have to interpret the wall clock IN
 * `shopTz` and convert to a real UTC instant. Without that conversion, a
 * Sydney shop (UTC+10/+11) is off by ~10 hours and the cutoff misbehaves
 * silently — passes on UTC dev boxes, fails in production.
 */

type SlotForCutoff = {
  date: Date;
  timeStart: string;
  cutoffOffsetMinutes: number | null;
};

/**
 * Returns true once the slot's cutoff has passed in `tz`. The slot is
 * always sourced from a Location, so `tz` should be `slot.location.timezone`
 * (per-location timezone, not shop-level — multi-location merchants can
 * ship from different time zones).
 *
 * Throws `RangeError` if `tz` is empty or not a valid IANA tz name —
 * `Intl.DateTimeFormat` enforces this. Callers should treat the throw as
 * "tz is misconfigured; can't safely apply the cutoff" and fall through to
 * leaving the slot visible (over-filtering would silently empty the
 * storefront grid for a single bad timezone, which is worse UX than
 * letting one slot slip past its cutoff). Both call sites
 * (`api.recommendations.slots.tsx` and `api.carrier-service.rates.tsx`)
 * wrap in try/catch and log a warn on bad tz.
 */
export function isSlotCutoffPassed(
  slot: SlotForCutoff,
  now: Date,
  tz: string,
): boolean {
  if (slot.cutoffOffsetMinutes == null) return false;

  const [h, m] = parseHHMM(slot.timeStart);
  const y = slot.date.getUTCFullYear();
  const mo = slot.date.getUTCMonth();
  const d = slot.date.getUTCDate();

  const slotStartUtcMs = wallClockInTzToUtcMs({ y, mo, d, h, m }, tz);
  const cutoffAtMs = slotStartUtcMs - slot.cutoffOffsetMinutes * 60_000;
  return now.getTime() >= cutoffAtMs;
}

function parseHHMM(s: string): [number, number] {
  const [hh, mm] = s.split(":").map((p) => parseInt(p, 10));
  return [Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0];
}

/**
 * Validates that `tz` is an IANA timezone name accepted by
 * `Intl.DateTimeFormat` — i.e. one that won't make `isSlotCutoffPassed`
 * throw at runtime. Use at the form save layer for any field that flows
 * into a slot's location timezone, so the helper's "throws on bad tz"
 * contract becomes a defense-in-depth backstop rather than something the
 * runtime fail-open path actually reaches.
 *
 * Empty string / non-string / unrecognized name → false.
 */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Coerce a cutoff value off form-submitted JSON. Accepts:
 *   null/undefined → null
 *   finite non-negative number → that number (rounded to int minutes)
 *   anything else → null (no cutoff)
 *
 * Range validation (≤1440 min) lives in the route action — this helper
 * just normalizes the type.
 */
export function parseCutoffOffsetMinutes(value: unknown): number | null {
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

/**
 * Convert a wall-clock moment in `tz` to the corresponding real UTC instant
 * (ms since epoch). Handles DST because the offset used is the one for the
 * specified wall clock, not "now."
 *
 * Approach: pretend the wall clock is UTC, format that naive UTC instant in
 * `tz` to discover what `tz` thinks the wall clock is, and back out the
 * offset.
 *
 * Exported so the lead-time filter (`slot-leadtime.server.ts`) can reuse the
 * same wall-clock-to-UTC conversion the cutoff filter uses — keeping the
 * two filters consistent on DST-day edge cases.
 */
export function wallClockInTzToUtcMs(
  parts: { y: number; mo: number; d: number; h: number; m: number },
  tz: string,
): number {
  const naiveUtcMs = Date.UTC(parts.y, parts.mo, parts.d, parts.h, parts.m);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const fmtParts = dtf.formatToParts(new Date(naiveUtcMs));
  const get = (t: string) => Number(fmtParts.find((p) => p.type === t)?.value);
  const tzY = get("year");
  const tzMo = get("month") - 1;
  const tzD = get("day");
  // Some Intl implementations emit "24" for midnight; normalize to 0.
  const rawH = get("hour");
  const tzH = rawH === 24 ? 0 : rawH;
  const tzM = get("minute");
  const tzAsUtcMs = Date.UTC(tzY, tzMo, tzD, tzH, tzM);
  const offsetMs = tzAsUtcMs - naiveUtcMs;
  return naiveUtcMs - offsetMs;
}
