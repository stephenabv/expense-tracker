import { describe, expect, it } from "vitest";

import type { Expense, TrackerState } from "@/types/expense";
import type { HistoryDay } from "@/types/history";
import {
  backfillHistory,
  describeFilter,
  filterHistory,
  formatDateKey,
  fromDateKey,
  groupExpensesByDate,
  matchesFilter,
  presetToFilter,
  summarizeHistory,
  syncHistory,
  toDateKey,
  validateFilter,
} from "@/lib/history";

/** Builds an expense at a local wall-clock time, avoiding UTC drift in tests. */
function expense(
  id: string,
  name: string,
  amount: number,
  local: string,
): Expense {
  return { id, name, amount, createdAt: new Date(local).toISOString() };
}

function day(date: string, overrides: Partial<HistoryDay> = {}): HistoryDay {
  return {
    date,
    budget: 1_000,
    startingBalance: 1_000,
    endingBalance: 900,
    totalExpenses: 100,
    expenses: [],
    ...overrides,
  };
}

describe("toDateKey / fromDateKey", () => {
  it("uses the local calendar day, not UTC", () => {
    // Late evening local time must not roll into the next UTC day.
    expect(toDateKey(new Date(2026, 7, 17, 23, 30))).toBe("2026-08-17");
    expect(toDateKey(new Date(2026, 7, 17, 0, 15))).toBe("2026-08-17");
  });

  it("zero-pads months and days", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("returns an empty key for an unparseable date", () => {
    expect(toDateKey("not a date")).toBe("");
  });

  it("round-trips through fromDateKey", () => {
    expect(toDateKey(fromDateKey("2026-08-17")!)).toBe("2026-08-17");
  });

  it("rejects malformed keys", () => {
    expect(fromDateKey("2026-8-17")).toBeNull();
    expect(fromDateKey("nope")).toBeNull();
  });
});

describe("formatDateKey / describeFilter", () => {
  it("formats a key as a long date", () => {
    expect(formatDateKey("2026-08-17")).toBe("August 17, 2026");
  });

  it("describes a single date", () => {
    expect(describeFilter({ mode: "single", date: "2026-08-17" })).toBe(
      "August 17, 2026",
    );
  });

  it("describes a range within one year without repeating it", () => {
    expect(
      describeFilter({ mode: "range", start: "2026-08-01", end: "2026-08-17" }),
    ).toBe("August 1 – August 17, 2026");
  });

  it("keeps both years when a range spans them", () => {
    expect(
      describeFilter({ mode: "range", start: "2025-12-30", end: "2026-01-02" }),
    ).toBe("December 30, 2025 – January 2, 2026");
  });

  it("collapses a single-day range", () => {
    expect(
      describeFilter({ mode: "range", start: "2026-08-17", end: "2026-08-17" }),
    ).toBe("August 17, 2026");
  });
});

describe("validateFilter", () => {
  it("accepts a valid single date and range", () => {
    expect(validateFilter({ mode: "single", date: "2026-08-17" })).toBeNull();
    expect(
      validateFilter({ mode: "range", start: "2026-08-01", end: "2026-08-17" }),
    ).toBeNull();
    expect(validateFilter({ mode: "all" })).toBeNull();
  });

  it("accepts a range whose ends are the same day", () => {
    expect(
      validateFilter({ mode: "range", start: "2026-08-17", end: "2026-08-17" }),
    ).toBeNull();
  });

  it("rejects a start after the end", () => {
    expect(
      validateFilter({ mode: "range", start: "2026-08-18", end: "2026-08-17" }),
    ).toMatch(/on or before/);
  });

  it("rejects malformed dates", () => {
    expect(validateFilter({ mode: "single", date: "" })).toMatch(/valid date/);
    expect(
      validateFilter({ mode: "range", start: "oops", end: "2026-08-17" }),
    ).toMatch(/valid start and end/);
  });
});

describe("matchesFilter", () => {
  it("includes both ends of a range", () => {
    const filter = { mode: "range", start: "2026-08-01", end: "2026-08-17" } as const;
    expect(matchesFilter("2026-08-01", filter)).toBe(true);
    expect(matchesFilter("2026-08-17", filter)).toBe(true);
    expect(matchesFilter("2026-08-09", filter)).toBe(true);
  });

  it("excludes days outside the range", () => {
    const filter = { mode: "range", start: "2026-08-01", end: "2026-08-17" } as const;
    expect(matchesFilter("2026-07-31", filter)).toBe(false);
    expect(matchesFilter("2026-08-18", filter)).toBe(false);
  });

  it("matches only the chosen day for a single filter", () => {
    const filter = { mode: "single", date: "2026-08-17" } as const;
    expect(matchesFilter("2026-08-17", filter)).toBe(true);
    expect(matchesFilter("2026-08-16", filter)).toBe(false);
  });

  it("matches everything for the all filter", () => {
    expect(matchesFilter("1999-01-01", { mode: "all" })).toBe(true);
  });
});

describe("groupExpensesByDate", () => {
  it("groups multiple expenses recorded on the same day", () => {
    const groups = groupExpensesByDate([
      expense("1", "Food", 500, "2026-08-17T08:00:00"),
      expense("2", "Coffee", 150, "2026-08-17T16:00:00"),
      expense("3", "Taxi", 300, "2026-08-16T09:00:00"),
    ]);

    expect(groups.get("2026-08-17")).toHaveLength(2);
    expect(groups.get("2026-08-16")).toHaveLength(1);
  });

  it("skips expenses with an unusable timestamp", () => {
    const groups = groupExpensesByDate([
      { id: "x", name: "Broken", amount: 10, createdAt: "nonsense" },
    ]);
    expect(groups.size).toBe(0);
  });
});

describe("backfillHistory", () => {
  const now = new Date(2026, 7, 17, 12, 0);

  const state: TrackerState = {
    budget: 13_000,
    expenses: [
      expense("1", "Food", 500, "2026-08-16T08:00:00"),
      expense("2", "Taxi", 300, "2026-08-17T09:00:00"),
      expense("3", "Coffee", 150, "2026-08-17T16:00:00"),
    ],
  };

  it("creates one record per active day, oldest first", () => {
    const history = backfillHistory(state, now);
    expect(history.map((entry) => entry.date)).toEqual([
      "2026-08-16",
      "2026-08-17",
    ]);
  });

  it("records the daily total, not the running total", () => {
    const history = backfillHistory(state, now);
    expect(history[0].totalExpenses).toBe(500);
    expect(history[1].totalExpenses).toBe(450);
  });

  it("chains balances across days", () => {
    const history = backfillHistory(state, now);
    expect(history[0].startingBalance).toBe(13_000);
    expect(history[0].endingBalance).toBe(12_500);
    expect(history[1].startingBalance).toBe(12_500);
    expect(history[1].endingBalance).toBe(12_050);
  });

  it("ignores future-dated expenses", () => {
    const history = backfillHistory(
      {
        budget: 100,
        expenses: [expense("f", "Later", 10, "2026-08-20T09:00:00")],
      },
      now,
    );
    expect(history).toHaveLength(0);
  });

  it("returns nothing for an empty tracker", () => {
    expect(backfillHistory({ budget: null, expenses: [] }, now)).toEqual([]);
  });
});

describe("syncHistory", () => {
  const now = new Date(2026, 7, 17, 12, 0);

  it("records today once something is spent", () => {
    const history = syncHistory(
      [],
      {
        budget: 1_000,
        expenses: [expense("1", "Food", 200, "2026-08-17T08:00:00")],
      },
      now,
    );

    expect(history).toHaveLength(1);
    expect(history[0].date).toBe("2026-08-17");
    expect(history[0].totalExpenses).toBe(200);
    expect(history[0].endingBalance).toBe(800);
  });

  it("does not invent an empty record for a day with no expenses", () => {
    expect(syncHistory([], { budget: 1_000, expenses: [] }, now)).toEqual([]);
  });

  it("keeps today's record in step with the live tracker", () => {
    const first = syncHistory(
      [],
      {
        budget: 1_000,
        expenses: [expense("1", "Food", 200, "2026-08-17T08:00:00")],
      },
      now,
    );

    const second = syncHistory(
      first,
      {
        budget: 1_000,
        expenses: [
          expense("1", "Food", 200, "2026-08-17T08:00:00"),
          expense("2", "Taxi", 100, "2026-08-17T10:00:00"),
        ],
      },
      now,
    );

    expect(second).toHaveLength(1);
    expect(second[0].totalExpenses).toBe(300);
    expect(second[0].endingBalance).toBe(700);
  });

  it("leaves a past day untouched when the budget changes", () => {
    const sealed = day("2026-08-16", {
      budget: 13_000,
      startingBalance: 13_000,
      endingBalance: 12_500,
      totalExpenses: 500,
      expenses: [expense("1", "Food", 500, "2026-08-16T08:00:00")],
    });

    // The user later slashes the budget to 1,000.
    const history = syncHistory(
      [sealed],
      {
        budget: 1_000,
        expenses: [expense("1", "Food", 500, "2026-08-16T08:00:00")],
      },
      now,
    );

    const yesterday = history.find((entry) => entry.date === "2026-08-16")!;
    expect(yesterday.budget).toBe(13_000);
    expect(yesterday.endingBalance).toBe(12_500);
  });

  it("leaves a past day untouched when its expense is deleted today", () => {
    const sealed = day("2026-08-16", {
      budget: 13_000,
      startingBalance: 13_000,
      endingBalance: 12_500,
      totalExpenses: 500,
      expenses: [expense("1", "Food", 500, "2026-08-16T08:00:00")],
    });

    const history = syncHistory([sealed], { budget: 13_000, expenses: [] }, now);

    expect(history).toHaveLength(1);
    expect(history[0].totalExpenses).toBe(500);
    expect(history[0].expenses).toHaveLength(1);
  });

  it("does not mutate the frozen expense copies when the live expense changes", () => {
    const live = expense("1", "Food", 500, "2026-08-17T08:00:00");
    const history = syncHistory([], { budget: 1_000, expenses: [live] }, now);

    live.name = "Renamed";
    live.amount = 9_999;

    expect(history[0].expenses[0].name).toBe("Food");
    expect(history[0].expenses[0].amount).toBe(500);
  });

  it("backfills a past day that has expenses but no record", () => {
    const history = syncHistory(
      [],
      {
        budget: 1_000,
        expenses: [
          expense("1", "Food", 200, "2026-08-15T08:00:00"),
          expense("2", "Taxi", 100, "2026-08-17T08:00:00"),
        ],
      },
      now,
    );

    expect(history.map((entry) => entry.date)).toEqual([
      "2026-08-15",
      "2026-08-17",
    ]);
  });

  it("never overwrites an existing sealed record while backfilling", () => {
    const sealed = day("2026-08-15", {
      budget: 500,
      totalExpenses: 42,
      startingBalance: 500,
      endingBalance: 458,
    });

    const history = syncHistory(
      [sealed],
      {
        budget: 1_000,
        expenses: [expense("1", "Food", 200, "2026-08-15T08:00:00")],
      },
      now,
    );

    expect(history[0].totalExpenses).toBe(42);
    expect(history[0].budget).toBe(500);
  });
});

describe("filterHistory", () => {
  const history = [
    day("2026-08-15", { totalExpenses: 100 }),
    day("2026-08-16", { totalExpenses: 200 }),
    day("2026-08-17", { totalExpenses: 300 }),
  ];

  it("returns a single day", () => {
    const result = filterHistory(history, { mode: "single", date: "2026-08-16" });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-08-16");
  });

  it("returns nothing for a day with no record", () => {
    expect(filterHistory(history, { mode: "single", date: "2026-08-18" })).toEqual([]);
  });

  it("includes both ends of a range", () => {
    const result = filterHistory(history, {
      mode: "range",
      start: "2026-08-15",
      end: "2026-08-17",
    });
    expect(result).toHaveLength(3);
  });

  it("returns newest first", () => {
    const result = filterHistory(history, { mode: "all" });
    expect(result.map((entry) => entry.date)).toEqual([
      "2026-08-17",
      "2026-08-16",
      "2026-08-15",
    ]);
  });

  it("returns nothing from an empty history", () => {
    expect(filterHistory([], { mode: "all" })).toEqual([]);
  });
});

describe("summarizeHistory", () => {
  const history = [
    day("2026-08-15", {
      budget: 13_000,
      startingBalance: 13_000,
      endingBalance: 12_500,
      totalExpenses: 500,
      expenses: [expense("1", "Food", 500, "2026-08-15T08:00:00")],
    }),
    day("2026-08-16", {
      budget: 13_000,
      startingBalance: 12_500,
      endingBalance: 12_200,
      totalExpenses: 300,
      expenses: [expense("2", "Taxi", 300, "2026-08-16T08:00:00")],
    }),
    day("2026-08-17", {
      budget: 15_000,
      startingBalance: 14_200,
      endingBalance: 14_050,
      totalExpenses: 150,
      expenses: [expense("3", "Coffee", 150, "2026-08-17T08:00:00")],
    }),
  ];

  it("sums only the daily expense totals", () => {
    expect(summarizeHistory(history).totalExpenses).toBe(950);
  });

  it("takes the starting figures from the earliest day", () => {
    const summary = summarizeHistory(history);
    expect(summary.startingBudget).toBe(13_000);
    expect(summary.startingBalance).toBe(13_000);
  });

  it("takes the ending balance from the latest day rather than recomputing it", () => {
    // 13,000 - 950 would be 12,050; the recorded value reflects the later
    // budget change and is the one that must be reported.
    expect(summarizeHistory(history).endingBalance).toBe(14_050);
  });

  it("counts expenses and active days", () => {
    const summary = summarizeHistory(history);
    expect(summary.expenseCount).toBe(3);
    expect(summary.activeDays).toBe(3);
  });

  it("reports the range covered", () => {
    const summary = summarizeHistory(history);
    expect(summary.firstDate).toBe("2026-08-15");
    expect(summary.lastDate).toBe("2026-08-17");
  });

  it("is order-independent", () => {
    const shuffled = [history[2], history[0], history[1]];
    expect(summarizeHistory(shuffled)).toEqual(summarizeHistory(history));
  });

  it("returns zeroes and null dates for an empty selection", () => {
    const summary = summarizeHistory([]);
    expect(summary.totalExpenses).toBe(0);
    expect(summary.activeDays).toBe(0);
    expect(summary.firstDate).toBeNull();
  });

  it("stays exact across many fractional daily totals", () => {
    const days = Array.from({ length: 10 }, (_, index) =>
      day(`2026-08-${String(index + 1).padStart(2, "0")}`, { totalExpenses: 0.1 }),
    );
    expect(summarizeHistory(days).totalExpenses).toBe(1);
  });
});

describe("presetToFilter", () => {
  const now = new Date(2026, 7, 17, 12, 0);

  it("resolves today and yesterday", () => {
    expect(presetToFilter("today", now)).toEqual({
      mode: "single",
      date: "2026-08-17",
    });
    expect(presetToFilter("yesterday", now)).toEqual({
      mode: "single",
      date: "2026-08-16",
    });
  });

  it("makes last 7 days inclusive of today", () => {
    expect(presetToFilter("last7", now)).toEqual({
      mode: "range",
      start: "2026-08-11",
      end: "2026-08-17",
    });
  });

  it("resolves this month up to today", () => {
    expect(presetToFilter("thisMonth", now)).toEqual({
      mode: "range",
      start: "2026-08-01",
      end: "2026-08-17",
    });
  });

  it("resolves last month to its full span", () => {
    expect(presetToFilter("lastMonth", now)).toEqual({
      mode: "range",
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("handles last month across a year boundary", () => {
    expect(presetToFilter("lastMonth", new Date(2026, 0, 15))).toEqual({
      mode: "range",
      start: "2025-12-01",
      end: "2025-12-31",
    });
  });

  it("resolves all", () => {
    expect(presetToFilter("all", now)).toEqual({ mode: "all" });
  });
});
