import { describe, expect, it } from "vitest";

import {
  daysBetween,
  enumerateDates,
  formatDateKey,
  formatDateRange,
  formatShortDateRange,
  fromDateKey,
  isValidDateKey,
  isWithinRange,
  overlapRange,
  rangesOverlap,
  shiftDateKey,
  toDateKey,
} from "@/lib/dates";

describe("toDateKey / fromDateKey", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(toDateKey(new Date(2026, 7, 17, 23, 30))).toBe("2026-08-17");
    expect(toDateKey(new Date(2026, 7, 17, 0, 15))).toBe("2026-08-17");
  });

  it("zero-pads months and days", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("returns an empty key for an unparseable date", () => {
    expect(toDateKey("not a date")).toBe("");
  });

  it("round-trips", () => {
    expect(toDateKey(fromDateKey("2026-08-17")!)).toBe("2026-08-17");
  });

  it("rejects malformed keys", () => {
    expect(fromDateKey("2026-8-17")).toBeNull();
    expect(isValidDateKey("nope")).toBe(false);
    expect(isValidDateKey("2026-08-17")).toBe(true);
  });
});

describe("shiftDateKey / daysBetween", () => {
  it("shifts across a month boundary", () => {
    expect(shiftDateKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDateKey("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("counts inclusive days", () => {
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(1);
    expect(daysBetween("2026-08-01", "2026-08-05")).toBe(5);
  });
});

describe("enumerateDates", () => {
  it("includes both ends", () => {
    expect(enumerateDates("2026-08-01", "2026-08-03")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("returns nothing for a reversed range", () => {
    expect(enumerateDates("2026-08-03", "2026-08-01")).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats a long date", () => {
    expect(formatDateKey("2026-08-17")).toBe("August 17, 2026");
  });

  it("drops the repeated year within one year", () => {
    expect(formatDateRange("2026-08-01", "2026-08-17")).toBe(
      "August 1 – August 17, 2026",
    );
  });

  it("keeps both years across a boundary", () => {
    expect(formatDateRange("2025-12-30", "2026-01-02")).toBe(
      "December 30, 2025 – January 2, 2026",
    );
  });

  it("collapses a single-day range", () => {
    expect(formatDateRange("2026-08-17", "2026-08-17")).toBe("August 17, 2026");
    expect(formatShortDateRange("2026-08-17", "2026-08-17")).toBe("Aug 17");
  });

  it("formats a short range", () => {
    expect(formatShortDateRange("2026-08-01", "2026-08-05")).toBe("Aug 1 – Aug 5");
  });
});

describe("ranges", () => {
  it("treats ranges as inclusive", () => {
    expect(isWithinRange("2026-08-01", "2026-08-01", "2026-08-05")).toBe(true);
    expect(isWithinRange("2026-08-05", "2026-08-01", "2026-08-05")).toBe(true);
    expect(isWithinRange("2026-08-06", "2026-08-01", "2026-08-05")).toBe(false);
  });

  it("detects overlap, including a shared endpoint", () => {
    expect(rangesOverlap("2026-08-01", "2026-08-10", "2026-08-05", "2026-08-15")).toBe(true);
    expect(rangesOverlap("2026-08-01", "2026-08-05", "2026-08-05", "2026-08-09")).toBe(true);
    expect(rangesOverlap("2026-08-01", "2026-08-05", "2026-08-06", "2026-08-09")).toBe(false);
  });

  it("returns the shared span", () => {
    expect(overlapRange("2026-08-01", "2026-08-10", "2026-08-05", "2026-08-15")).toEqual({
      start: "2026-08-05",
      end: "2026-08-10",
    });
    expect(overlapRange("2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04")).toBeNull();
  });
});
