/**
 * Tests for the slot cutoff helper.
 *
 * Sydney cases below catch a class of silent bug: comparing a wall-clock-
 * as-UTC slot start against a real-UTC `now` is off by the shop offset
 * (~10h for Sydney). The naive implementation passes on a UTC dev box and
 * misbehaves in production. Each Sydney case is constructed so a
 * non-tz-aware helper would invert the answer.
 */

import { describe, it, expect } from "vitest";
import { isSlotCutoffPassed, isValidIanaTimezone } from "../app/services/slot-cutoff.server";

const utcDate = (iso: string): Date => new Date(iso);

describe("isValidIanaTimezone — form-save guard", () => {
  // The location form-save action calls this to reject bad input before it
  // reaches the DB, making the helper's "throws on bad tz" runtime guard
  // genuinely unreachable in normal operation.
  it("accepts known IANA names", () => {
    expect(isValidIanaTimezone("UTC")).toBe(true);
    expect(isValidIanaTimezone("Australia/Sydney")).toBe(true);
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
    expect(isValidIanaTimezone("Europe/London")).toBe(true);
  });

  it("rejects empty string and whitespace-only", () => {
    expect(isValidIanaTimezone("")).toBe(false);
    expect(isValidIanaTimezone("   ")).toBe(false);
  });

  it("rejects names ICU does not recognize", () => {
    // The job here is "won't make Intl.DateTimeFormat throw at runtime,"
    // not "is canonical IANA." ICU accepts some legacy aliases like "PST"
    // and "GMT" — those won't throw, so they pass. The form-save guard's
    // purpose is catching typos like "Asia/InvalidZone" before they reach
    // the DB and trip the runtime fail-open path.
    expect(isValidIanaTimezone("Asia/InvalidZone")).toBe(false);
    expect(isValidIanaTimezone("Not/A_Real_Tz")).toBe(false);
    expect(isValidIanaTimezone("Australia/NotARealCity")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidIanaTimezone(undefined)).toBe(false);
    expect(isValidIanaTimezone(null)).toBe(false);
    expect(isValidIanaTimezone(42)).toBe(false);
    expect(isValidIanaTimezone({})).toBe(false);
  });
});

describe("isSlotCutoffPassed — null cutoff", () => {
  it("returns false regardless of tz when cutoffOffsetMinutes is null", () => {
    const slot = {
      date: utcDate("2026-05-09T00:00:00Z"),
      timeStart: "11:00",
      cutoffOffsetMinutes: null,
    };
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T11:00:00Z"), "UTC")).toBe(false);
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T15:00:00Z"), "Australia/Sydney")).toBe(false);
  });
});

describe("isSlotCutoffPassed — UTC tz", () => {
  const slot = {
    date: utcDate("2026-05-09T00:00:00Z"),
    timeStart: "11:00",
    cutoffOffsetMinutes: 60,
  };

  it("not passed when slot is 2h away (well before cutoff)", () => {
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T09:00:00Z"), "UTC")).toBe(false);
  });

  it("not passed exactly at cutoff−1ms", () => {
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T09:59:59.999Z"), "UTC")).toBe(false);
  });

  it("passed at the cutoff instant", () => {
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T10:00:00Z"), "UTC")).toBe(true);
  });

  it("passed when slot starts in 30m (cutoff was 1h before start)", () => {
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T10:30:00Z"), "UTC")).toBe(true);
  });

  it("passed after slot has started", () => {
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T11:10:00Z"), "UTC")).toBe(true);
  });

  it("midnight rollover: slot at 01:00 next day, 120m cutoff trips at 23:00 prev day", () => {
    const slotEarly = {
      date: utcDate("2026-05-10T00:00:00Z"),
      timeStart: "01:00",
      cutoffOffsetMinutes: 120,
    };
    // cutoff = 2026-05-10T01:00 - 2h = 2026-05-09T23:00Z
    expect(isSlotCutoffPassed(slotEarly, utcDate("2026-05-09T22:59:00Z"), "UTC")).toBe(false);
    expect(isSlotCutoffPassed(slotEarly, utcDate("2026-05-09T23:00:00Z"), "UTC")).toBe(true);
  });
});

describe("isSlotCutoffPassed — invalid tz (caller is responsible for fallback)", () => {
  // Document the helper's contract explicitly so a future refactor can't
  // silently swap in a fall-through-to-UTC branch. The two call sites
  // wrap in try/catch and treat throws as "leave slot visible" + warn log.
  const slot = {
    date: utcDate("2026-05-09T00:00:00Z"),
    timeStart: "11:00",
    cutoffOffsetMinutes: 60,
  };

  it("throws RangeError on empty tz string", () => {
    expect(() => isSlotCutoffPassed(slot, utcDate("2026-05-09T10:30:00Z"), "")).toThrow(
      RangeError,
    );
  });

  it("throws RangeError on non-IANA tz name", () => {
    expect(() =>
      isSlotCutoffPassed(slot, utcDate("2026-05-09T10:30:00Z"), "Not/A_Real_Tz"),
    ).toThrow(RangeError);
  });

  it("does not throw on null cutoffOffsetMinutes regardless of tz validity", () => {
    // Short-circuit: null cutoff means the helper never reaches the Intl
    // call, so even a garbage tz is safe. Lets callers skip the try/catch
    // for the common-case "no cutoff configured" path.
    const noCutoff = { ...slot, cutoffOffsetMinutes: null };
    expect(() => isSlotCutoffPassed(noCutoff, utcDate("2026-05-09T10:30:00Z"), "")).not.toThrow();
    expect(isSlotCutoffPassed(noCutoff, utcDate("2026-05-09T10:30:00Z"), "")).toBe(false);
  });
});

describe("isSlotCutoffPassed — Australia/Sydney tz (catches the offset bug)", () => {
  // Sydney is UTC+10 in May (standard time). The slot's wall clock
  // "May 9 11:00 Sydney" is the real UTC instant 2026-05-09T01:00Z.
  // With cutoffOffsetMinutes=240 (4h), cutoff = 07:00 Sydney May 9 =
  // 2026-05-08T21:00Z.
  const slot = {
    date: utcDate("2026-05-09T00:00:00Z"),
    timeStart: "11:00",
    cutoffOffsetMinutes: 240,
  };
  const tz = "Australia/Sydney";

  it("passed when now is 4h after slot start (15:00 Sydney, well past cutoff)", () => {
    // now = 2026-05-09T05:00Z = 15:00 Sydney. truth: passed.
    // Naive UTC implementation: cutoffAt computed as 11:00Z − 4h = 07:00Z;
    // 05:00Z is BEFORE 07:00Z, so naive returns false (wrong). This
    // assertion fails on the buggy implementation.
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-09T05:00:00Z"), tz)).toBe(true);
  });

  it("not passed when now is 2h before cutoff (05:00 Sydney, cutoff is 07:00 Sydney)", () => {
    // now = 2026-05-08T19:00Z = 05:00 Sydney May 9.
    // cutoff is 07:00 Sydney = 2026-05-08T21:00Z. 19:00Z < 21:00Z → not passed.
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-08T19:00:00Z"), tz)).toBe(false);
  });

  it("passed exactly at cutoff (07:00 Sydney)", () => {
    // 07:00 Sydney = 2026-05-08T21:00Z
    expect(isSlotCutoffPassed(slot, utcDate("2026-05-08T21:00:00Z"), tz)).toBe(true);
  });

  it("DST end (Apr 5 2026, UTC+11→UTC+10): same wall clock differs from DST start by 1h", () => {
    // April 5 2026 is the day NSW exits DST (clocks fall back at 03:00).
    // At 09:00 Sydney we're already in standard time UTC+10 →
    // 09:00 Sydney = 23:00Z April 4.
    // October 5 2026 is during DST UTC+11 →
    // 09:00 Sydney = 22:00Z October 4.
    // Verify the helper picks the offset for the slot's wall clock, not "now."
    const slotApr = { date: utcDate("2026-04-05T00:00:00Z"), timeStart: "09:00", cutoffOffsetMinutes: 60 };
    const slotOct = { date: utcDate("2026-10-05T00:00:00Z"), timeStart: "09:00", cutoffOffsetMinutes: 60 };

    // April 5 09:00 Sydney → cutoff = 08:00 Sydney = 22:00Z April 4
    expect(isSlotCutoffPassed(slotApr, utcDate("2026-04-04T21:59:00Z"), tz)).toBe(false);
    expect(isSlotCutoffPassed(slotApr, utcDate("2026-04-04T22:00:00Z"), tz)).toBe(true);

    // October 5 09:00 Sydney → cutoff = 08:00 Sydney = 21:00Z October 4
    expect(isSlotCutoffPassed(slotOct, utcDate("2026-10-04T20:59:00Z"), tz)).toBe(false);
    expect(isSlotCutoffPassed(slotOct, utcDate("2026-10-04T21:00:00Z"), tz)).toBe(true);
  });
});
