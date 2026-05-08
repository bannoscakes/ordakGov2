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
import { isSlotCutoffPassed } from "../app/services/slot-cutoff.server";

const utcDate = (iso: string): Date => new Date(iso);

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
