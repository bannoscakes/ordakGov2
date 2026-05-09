/**
 * Blackout-date filter for slots (Phase 1.5.B).
 *
 * Storage: Location.blackoutDates is a DateTime[] of UTC-midnight timestamps,
 * one per blacked-out calendar date. The slot materializer writes
 * Slot.date with hours zeroed (`setHours(0, 0, 0, 0)`) on a UTC-default
 * server, so both sides land at UTC midnight and `getTime()` equality is
 * exact.
 *
 * The helpers here normalize both sides to UTC midnight defensively, so a
 * server tz drift or a hand-edited row doesn't silently miss matches.
 */

export function isSlotDateBlackedOut(
  slotDate: Date,
  blackoutDates: Date[],
): boolean {
  if (blackoutDates.length === 0) return false;
  const slotKey = utcMidnightKey(slotDate);
  return blackoutDates.some((d) => utcMidnightKey(d) === slotKey);
}

function utcMidnightKey(d: Date): number {
  const c = new Date(d.getTime());
  c.setUTCHours(0, 0, 0, 0);
  return c.getTime();
}

/**
 * Parse an array of "YYYY-MM-DD" strings into Date[] at UTC midnight.
 * Used by the admin form action to convert merchant input to DB format.
 * Silently filters out malformed entries — the action validates upstream.
 */
export function parseDateStrings(strs: string[]): Date[] {
  const out: Date[] = [];
  const seen = new Set<number>();
  for (const s of strs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
    const d = new Date(`${s}T00:00:00.000Z`);
    const t = d.getTime();
    if (Number.isNaN(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(d);
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/**
 * Format a Date to "YYYY-MM-DD" using its UTC components. Inverse of
 * parseDateStrings — used by the loader to send the admin UI a stable
 * string representation it can compare in client code without timezone
 * drift.
 */
export function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
