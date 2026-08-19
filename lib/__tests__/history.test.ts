import { describe, expect, it } from "vitest";

import {
  buildHistory,
  budgetsInFilter,
  describeBudgetFilter,
  describeFilter,
  filterHistory,
  historyForFilter,
  matchesFilter,
  presetToFilter,
  summarizeHistory,
  validateFilter,
} from "@/lib/history";
import { budget, expense, generalBudget } from "./helpers";

const week1 = budget("b1", "August Week 1", 5_000, "2026-08-01", "2026-08-05");
const daily = budget("b2", "Daily Expenses", 1_000, "2026-08-06");
const weekend = budget("b3", "Weekend Budget", 3_000, "2026-08-07", "2026-08-09");

const budgets = [week1, daily, weekend];

const expenses = [
  expense("e1", "b1", "Food", 500, "2026-08-01"),
  expense("e2", "b1", "Transportation", 300, "2026-08-02"),
  expense("e3", "b1", "Groceries", 1_500, "2026-08-05"),
  expense("e4", "b2", "Coffee", 100, "2026-08-06"),
  expense("e5", "b2", "Food", 300, "2026-08-06"),
];

describe("buildHistory", () => {
  it("records one entry per day per budget, oldest first", () => {
    const days = buildHistory(budgets, expenses);
    expect(days.map((day) => day.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-05",
      "2026-08-06",
    ]);
  });

  it("attributes each day to the budget that paid for it", () => {
    const days = buildHistory(budgets, expenses);
    expect(days[0].budgetName).toBe("August Week 1");
    expect(days[3].budgetName).toBe("Daily Expenses");
  });

  it("records the daily total, not the running total", () => {
    const days = buildHistory(budgets, expenses);
    expect(days[0].totalExpenses).toBe(500);
    expect(days[3].totalExpenses).toBe(400);
  });

  it("chains balances within a budget", () => {
    const days = buildHistory(budgets, expenses).filter((d) => d.budgetId === "b1");
    expect(days[0].startingBalance).toBe(5_000);
    expect(days[0].endingBalance).toBe(4_500);
    expect(days[1].startingBalance).toBe(4_500);
    expect(days[1].endingBalance).toBe(4_200);
    expect(days[2].endingBalance).toBe(2_700);
  });

  it("restarts the balance for each budget rather than carrying it over", () => {
    // The Daily budget opens at its own 1,000, not at Week 1's leftover.
    const day = buildHistory(budgets, expenses).find((d) => d.budgetId === "b2")!;
    expect(day.startingBalance).toBe(1_000);
    expect(day.endingBalance).toBe(600);
  });

  it("skips budgets with no expenses", () => {
    const days = buildHistory(budgets, expenses);
    expect(days.some((day) => day.budgetId === "b3")).toBe(false);
  });

  it("groups several expenses recorded on the same day", () => {
    const day = buildHistory(budgets, expenses).find((d) => d.date === "2026-08-06")!;
    expect(day.expenses).toHaveLength(2);
  });

  it("returns nothing when there is no data", () => {
    expect(buildHistory([], [])).toEqual([]);
    expect(buildHistory(budgets, [])).toEqual([]);
  });

  it("includes a back-dated expense in the day it is dated for", () => {
    const backdated = expense("late", "b1", "Forgotten", 200, "2026-08-03", "2026-08-20T09:00:00.000Z");
    const days = buildHistory(budgets, [...expenses, backdated]);
    const day = days.find((d) => d.date === "2026-08-03");
    expect(day).toBeDefined();
    expect(day!.expenses[0].name).toBe("Forgotten");
  });
});

describe("filterHistory", () => {
  const days = buildHistory(budgets, expenses);

  it("returns a single day", () => {
    const result = filterHistory(days, { mode: "single", date: "2026-08-02" });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-08-02");
  });

  it("returns nothing for a day with no record", () => {
    expect(filterHistory(days, { mode: "single", date: "2026-08-03" })).toEqual([]);
  });

  it("includes both ends of a range", () => {
    const result = filterHistory(days, {
      mode: "range",
      start: "2026-08-01",
      end: "2026-08-06",
    });
    expect(result).toHaveLength(4);
  });

  it("excludes days outside the range", () => {
    const result = filterHistory(days, {
      mode: "range",
      start: "2026-08-02",
      end: "2026-08-05",
    });
    expect(result.map((day) => day.date)).toEqual(["2026-08-05", "2026-08-02"]);
  });

  it("returns newest first", () => {
    const result = filterHistory(days, { mode: "all" });
    expect(result[0].date).toBe("2026-08-06");
  });

  it("returns nothing from an empty history", () => {
    expect(filterHistory([], { mode: "all" })).toEqual([]);
  });
});

describe("summarizeHistory", () => {
  const all = historyForFilter(budgets, expenses, { mode: "all" });

  it("sums expenses across the period", () => {
    expect(summarizeHistory(all).totalExpenses).toBe(2_700);
  });

  it("adds up the allotments of the budgets in range", () => {
    // Week 1 (5,000) and Daily (1,000); the untouched weekend budget is absent.
    expect(summarizeHistory(all).totalAllocated).toBe(6_000);
  });

  it("adds up each budget's own remaining balance", () => {
    // Week 1 has 2,700 left and Daily has 600.
    expect(summarizeHistory(all).totalRemaining).toBe(3_300);
  });

  it("counts budgets, expenses and distinct active days", () => {
    const summary = summarizeHistory(all);
    expect(summary.budgetCount).toBe(2);
    expect(summary.expenseCount).toBe(5);
    expect(summary.activeDays).toBe(4);
  });

  it("breaks the period down per budget", () => {
    const summary = summarizeHistory(all);
    const week = summary.budgets.find((entry) => entry.budgetId === "b1")!;

    expect(week.budgetName).toBe("August Week 1");
    expect(week.budgetAmount).toBe(5_000);
    expect(week.totalExpenses).toBe(2_300);
    expect(week.remaining).toBe(2_700);
    expect(week.activeDays).toBe(3);
  });

  it("reports remaining as of the last in-range day, not the whole budget", () => {
    // Filtering to Aug 1–2 covers only 800 of Week 1's spending, so the
    // balance reported is the one that stood at the end of Aug 2.
    const partial = historyForFilter(budgets, expenses, {
      mode: "range",
      start: "2026-08-01",
      end: "2026-08-02",
    });
    const summary = summarizeHistory(partial);
    expect(summary.budgets[0].totalExpenses).toBe(800);
    expect(summary.budgets[0].remaining).toBe(4_200);
  });

  it("keeps one budget's figures out of another's", () => {
    const summary = summarizeHistory(all);
    const week = summary.budgets.find((e) => e.budgetId === "b1")!;
    const day = summary.budgets.find((e) => e.budgetId === "b2")!;
    expect(week.remaining).toBe(2_700);
    expect(day.remaining).toBe(600);
  });

  it("returns zeroes for an empty selection", () => {
    const summary = summarizeHistory([]);
    expect(summary.totalExpenses).toBe(0);
    expect(summary.budgetCount).toBe(0);
    expect(summary.firstDate).toBeNull();
    expect(summary.budgets).toEqual([]);
  });

  it("is order-independent", () => {
    const shuffled = [...all].reverse();
    expect(summarizeHistory(shuffled)).toEqual(summarizeHistory(all));
  });

  it("stays exact across many fractional amounts", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      expense(`f${i}`, "b2", "Coffee", 0.1, "2026-08-06"),
    );
    const days = buildHistory([daily], many);
    expect(summarizeHistory(days).totalExpenses).toBe(1);
  });
});

describe("validateFilter", () => {
  it("accepts valid filters", () => {
    expect(validateFilter({ mode: "all" })).toBeNull();
    expect(validateFilter({ mode: "single", date: "2026-08-17" })).toBeNull();
    expect(
      validateFilter({ mode: "range", start: "2026-08-01", end: "2026-08-17" }),
    ).toBeNull();
  });

  it("accepts a range whose ends match", () => {
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
    expect(matchesFilter("2026-07-31", filter)).toBe(false);
    expect(matchesFilter("2026-08-18", filter)).toBe(false);
  });
});

describe("describeFilter", () => {
  it("labels each mode", () => {
    expect(describeFilter({ mode: "all" })).toBe("All recorded history");
    expect(describeFilter({ mode: "single", date: "2026-08-17" })).toBe("August 17, 2026");
    expect(
      describeFilter({ mode: "range", start: "2026-08-01", end: "2026-08-17" }),
    ).toBe("August 1 – August 17, 2026");
  });
});

describe("presetToFilter", () => {
  const now = new Date(2026, 7, 17, 12, 0);

  it("resolves today and yesterday", () => {
    expect(presetToFilter("today", now)).toEqual({ mode: "single", date: "2026-08-17" });
    expect(presetToFilter("yesterday", now)).toEqual({ mode: "single", date: "2026-08-16" });
  });

  it("makes last 7 days inclusive of today", () => {
    expect(presetToFilter("last7", now)).toEqual({
      mode: "range",
      start: "2026-08-11",
      end: "2026-08-17",
    });
  });

  it("resolves this month and last month", () => {
    expect(presetToFilter("thisMonth", now)).toEqual({
      mode: "range",
      start: "2026-08-01",
      end: "2026-08-17",
    });
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
});

describe("budgetsInFilter", () => {
  it("returns budgets whose period intersects the range", () => {
    const result = budgetsInFilter(budgets, {
      mode: "range",
      start: "2026-08-05",
      end: "2026-08-07",
    });
    expect(result.map((b) => b.id).sort()).toEqual(["b1", "b2", "b3"]);
  });

  it("excludes budgets outside the range", () => {
    const result = budgetsInFilter(budgets, { mode: "single", date: "2026-08-06" });
    expect(result.map((b) => b.id)).toEqual(["b2"]);
  });
});

/* ------------------------------------------------- general allotments ---- */

const emergency = generalBudget("b4", "Emergency Fund", 10_000);

const mixedExpenses = [
  ...expenses,
  expense("g1", "b4", "Medicine", 1_000, "2026-08-19"),
  expense("g2", "b4", "Food", 300, "2026-08-19"),
  expense("g3", "b4", "Taxi", 250, "2026-09-01"),
];

describe("history with a general allotment", () => {
  const mixedBudgets = [...budgets, emergency];

  it("records its days like any other budget", () => {
    const days = buildHistory(mixedBudgets, mixedExpenses);
    const general = days.filter((day) => day.budgetId === "b4");
    expect(general.map((day) => day.date)).toEqual(["2026-08-19", "2026-09-01"]);
  });

  it("chains the balance within the allotment across unrelated dates", () => {
    const days = buildHistory(mixedBudgets, mixedExpenses);
    const general = days.filter((day) => day.budgetId === "b4");
    expect(general[0].startingBalance).toBe(10_000);
    expect(general[0].endingBalance).toBe(8_700);
    expect(general[1].startingBalance).toBe(8_700);
    expect(general[1].endingBalance).toBe(8_450);
  });

  it("carries null dates through, rather than inventing a period", () => {
    const days = buildHistory(mixedBudgets, mixedExpenses);
    const general = days.find((day) => day.budgetId === "b4")!;
    expect(general.budgetStartDate).toBeNull();
    expect(general.budgetEndDate).toBeNull();

    const dated = days.find((day) => day.budgetId === "b1")!;
    expect(dated.budgetStartDate).toBe("2026-08-01");
    expect(dated.budgetEndDate).toBe("2026-08-05");
  });

  it("appears in a single-date filter alongside no dated budget", () => {
    const days = historyForFilter(mixedBudgets, mixedExpenses, {
      mode: "single",
      date: "2026-08-19",
    });
    expect(days).toHaveLength(1);
    expect(days[0].budgetName).toBe("Emergency Fund");
    expect(days[0].totalExpenses).toBe(1_300);
  });

  it("groups by date and budget across a range", () => {
    const days = historyForFilter(mixedBudgets, mixedExpenses, {
      mode: "range",
      start: "2026-08-01",
      end: "2026-08-19",
    });
    // Newest first: Aug 19 is the general allotment, Aug 6 the daily one.
    expect(days[0].budgetName).toBe("Emergency Fund");
    expect(days[0].date).toBe("2026-08-19");
    expect(days.at(-1)!.date).toBe("2026-08-01");
  });

  it("is always available to a filter, having no period to intersect", () => {
    const result = budgetsInFilter(mixedBudgets, {
      mode: "single",
      date: "2026-12-25",
    });
    expect(result.map((b) => b.id)).toEqual(["b4"]);
  });

  it("reports its own allotment and balance in the summary", () => {
    const days = historyForFilter(mixedBudgets, mixedExpenses, { mode: "all" });
    const summary = summarizeHistory(days);
    const entry = summary.budgets.find((b) => b.budgetId === "b4")!;

    expect(entry.budgetAmount).toBe(10_000);
    expect(entry.totalExpenses).toBe(1_550);
    expect(entry.remaining).toBe(8_450);
    expect(entry.budgetStartDate).toBeNull();
  });
});

describe("history filtered to one budget", () => {
  const mixedBudgets = [...budgets, emergency];
  const all = buildHistory(mixedBudgets, mixedExpenses);

  it("keeps only that allotment's days", () => {
    const days = filterHistory(all, { mode: "all", budgetId: "b4" });
    expect(days.every((day) => day.budgetId === "b4")).toBe(true);
    expect(days).toHaveLength(2);
  });

  it("combines with a date filter", () => {
    const days = filterHistory(all, {
      mode: "range",
      start: "2026-08-01",
      end: "2026-08-31",
      budgetId: "b4",
    });
    expect(days.map((day) => day.date)).toEqual(["2026-08-19"]);
  });

  it("summarises only the selected allotment", () => {
    const summary = summarizeHistory(
      filterHistory(all, { mode: "all", budgetId: "b1" }),
    );
    expect(summary.budgetCount).toBe(1);
    expect(summary.totalAllocated).toBe(5_000);
    expect(summary.totalExpenses).toBe(2_300);
  });

  it("includes every budget with activity when none is selected", () => {
    // Three of the four: the weekend budget has no expenses, and a budget with
    // no spending is not a row of zeroes in the history.
    expect(summarizeHistory(filterHistory(all, { mode: "all" })).budgetCount).toBe(3);
    expect(
      summarizeHistory(filterHistory(all, { mode: "all", budgetId: null }))
        .budgetCount,
    ).toBe(3);
  });

  it("describes the selection for report metadata", () => {
    expect(describeBudgetFilter(mixedBudgets, { mode: "all", budgetId: "b4" })).toBe(
      "Emergency Fund (No Specific Date)",
    );
    expect(describeBudgetFilter(mixedBudgets, { mode: "all" })).toBeNull();
  });

  it("narrows budgetsInFilter to the selection", () => {
    expect(
      budgetsInFilter(mixedBudgets, { mode: "all", budgetId: "b2" }).map((b) => b.id),
    ).toEqual(["b2"]);
  });
});

describe("budget renaming", () => {
  it("keeps expenses attached by id and reports the current name", () => {
    const renamed = { ...week1, name: "Groceries Budget" };
    const days = buildHistory([renamed, daily, weekend], expenses);
    const affected = days.filter((day) => day.budgetId === "b1");

    expect(affected).toHaveLength(3);
    expect(affected.every((day) => day.budgetName === "Groceries Budget")).toBe(true);
    // The relationship survived the rename: the same three expenses, same totals.
    expect(summarizeHistory(days).budgets.find((b) => b.budgetId === "b1")!
      .totalExpenses).toBe(2_300);
  });
});
