import { describe, expect, it } from "vitest";

import {
  budgetApplicability,
  budgetStatus,
  budgetsForDate,
  budgetsForToday,
  coversDate,
  describeBudgetPeriod,
  generalBudgets,
  isGeneralBudget,
  needsReassignment,
  calculateBudgetRemaining,
  expensesForBudget,
  expensesOutsidePeriod,
  findOverlaps,
  isPeriodEnded,
  orphanedExpenses,
  resolveBudgetForDate,
  sortBudgetsByPeriod,
  summarizeBudget,
} from "@/lib/budgets";
import { budget, expense, generalBudget } from "./helpers";

const NOW = new Date(2026, 7, 6, 12, 0); // 6 August 2026

const week1 = budget("b1", "August Week 1", 5_000, "2026-08-01", "2026-08-05");
const daily = budget("b2", "Daily Budget", 1_000, "2026-08-06");
const weekend = budget("b3", "Weekend Budget", 3_000, "2026-08-07", "2026-08-09");
const emergency = generalBudget("b4", "Emergency Fund", 10_000);

const expenses = [
  expense("e1", "b1", "Food", 500, "2026-08-01"),
  expense("e2", "b1", "Transportation", 300, "2026-08-02"),
  expense("e3", "b1", "Groceries", 1_000, "2026-08-04"),
  expense("e4", "b2", "Food", 300, "2026-08-06"),
  expense("e5", "b2", "Coffee", 100, "2026-08-06"),
];

describe("expensesForBudget", () => {
  it("returns only that budget's expenses", () => {
    expect(expensesForBudget(expenses, "b1")).toHaveLength(3);
    expect(expensesForBudget(expenses, "b2")).toHaveLength(2);
    expect(expensesForBudget(expenses, "b3")).toHaveLength(0);
  });
});

describe("calculateBudgetRemaining", () => {
  it("applies the core rule per budget", () => {
    expect(calculateBudgetRemaining(week1, expenses)).toBe(3_200);
    expect(calculateBudgetRemaining(daily, expenses)).toBe(600);
  });

  it("is untouched by another budget's spending", () => {
    const before = calculateBudgetRemaining(week1, expenses);
    const withMore = [...expenses, expense("x", "b2", "Snack", 400, "2026-08-06")];
    expect(calculateBudgetRemaining(week1, withMore)).toBe(before);
  });

  it("is untouched when an unrelated budget is overspent", () => {
    const withOverspend = [
      ...expenses,
      expense("x", "b3", "Huge", 99_999, "2026-08-07"),
    ];
    expect(calculateBudgetRemaining(week1, withOverspend)).toBe(3_200);
  });

  it("goes negative when overspent", () => {
    const over = [expense("o", "b2", "Rent", 5_000, "2026-08-06")];
    expect(calculateBudgetRemaining(daily, over)).toBe(-4_000);
  });

  it("returns the full amount when nothing is charged", () => {
    expect(calculateBudgetRemaining(weekend, expenses)).toBe(3_000);
  });
});

describe("budgetStatus", () => {
  it("marks the period covering today as active", () => {
    expect(budgetStatus(daily, expenses, NOW)).toBe("active");
  });

  it("marks a finished period as completed", () => {
    expect(budgetStatus(week1, expenses, NOW)).toBe("period-ended");
  });

  it("marks a future period as upcoming", () => {
    expect(budgetStatus(weekend, expenses, NOW)).toBe("upcoming");
  });

  it("reports over-budget ahead of the calendar", () => {
    const over = [expense("o", "b1", "Rent", 9_000, "2026-08-01")];
    expect(budgetStatus(week1, over, NOW)).toBe("over-budget");
  });

  it("treats the first and last day as active", () => {
    expect(budgetStatus(week1, [], new Date(2026, 7, 1))).toBe("active");
    expect(budgetStatus(week1, [], new Date(2026, 7, 5))).toBe("active");
  });
});

describe("isPeriodEnded", () => {
  it("is true only after the period ends", () => {
    expect(isPeriodEnded(week1, NOW)).toBe(true);
    expect(isPeriodEnded(daily, NOW)).toBe(false);
    expect(isPeriodEnded(week1, new Date(2026, 7, 5))).toBe(false);
  });
});

describe("summarizeBudget", () => {
  it("derives every figure from the budget's own expenses", () => {
    const summary = summarizeBudget(week1, expenses, NOW);
    expect(summary.totalExpenses).toBe(1_800);
    expect(summary.remaining).toBe(3_200);
    expect(summary.expenseCount).toBe(3);
    expect(summary.status).toBe("period-ended");
    expect(summary.durationDays).toBe(5);
    expect(summary.isOverspent).toBe(false);
  });

  it("clamps the spent ratio and flags overspending", () => {
    const over = [expense("o", "b2", "Rent", 5_000, "2026-08-06")];
    const summary = summarizeBudget(daily, over, NOW);
    expect(summary.spentRatio).toBe(1);
    expect(summary.isOverspent).toBe(true);
  });

  it("does not divide by a zero allotment", () => {
    const zero = budget("z", "Zero", 0, "2026-08-06");
    const summary = summarizeBudget(zero, [], NOW);
    expect(summary.spentRatio).toBe(0);
    expect(summary.remaining).toBe(0);
  });

  it("counts a single-day period as one day", () => {
    expect(summarizeBudget(daily, [], NOW).durationDays).toBe(1);
  });
});

describe("budgetsForDate / resolveBudgetForDate", () => {
  const budgets = [week1, daily, weekend];

  it("finds the budget covering a date", () => {
    expect(resolveBudgetForDate(budgets, "2026-08-03")?.id).toBe("b1");
    expect(resolveBudgetForDate(budgets, "2026-08-06")?.id).toBe("b2");
    expect(resolveBudgetForDate(budgets, "2026-08-08")?.id).toBe("b3");
  });

  it("routes a date to the period that owns it, not the previous one", () => {
    // The Aug 1–5 budget must not claim Aug 6.
    expect(resolveBudgetForDate(budgets, "2026-08-06")?.name).toBe("Daily Budget");
  });

  it("includes both endpoints of a range", () => {
    expect(resolveBudgetForDate(budgets, "2026-08-07")?.id).toBe("b3");
    expect(resolveBudgetForDate(budgets, "2026-08-09")?.id).toBe("b3");
  });

  it("returns null when no budget covers the date", () => {
    expect(resolveBudgetForDate(budgets, "2026-08-20")).toBeNull();
    expect(budgetsForDate(budgets, "2026-08-20")).toEqual([]);
  });

  it("offers a general allotment alongside the dated one, dated first", () => {
    const options = budgetsForDate([week1, emergency], "2026-08-03");
    expect(options.map((b) => b.id)).toEqual(["b1", "b4"]);
    // Two eligible allotments means the user must choose.
    expect(resolveBudgetForDate([week1, emergency], "2026-08-03")).toBeNull();
  });

  it("offers a general allotment for a date no dated budget covers", () => {
    expect(budgetsForDate([week1, emergency], "2026-09-30").map((b) => b.id)).toEqual(
      ["b4"],
    );
    // One eligible allotment: no ambiguity to resolve.
    expect(resolveBudgetForDate([week1, emergency], "2026-09-30")?.id).toBe("b4");
  });

  it("never offers a budget covering an unrelated date", () => {
    const vacation = budget("v", "Vacation", 9_000, "2026-08-20", "2026-08-25");
    expect(
      budgetsForDate([week1, vacation, emergency], "2026-08-03").map((b) => b.id),
    ).not.toContain("v");
  });

  it("refuses to choose when several budgets cover the date", () => {
    const overlapping = [
      budget("a", "A", 5_000, "2026-08-01", "2026-08-10"),
      budget("b", "B", 3_000, "2026-08-05", "2026-08-15"),
    ];
    expect(budgetsForDate(overlapping, "2026-08-07")).toHaveLength(2);
    expect(resolveBudgetForDate(overlapping, "2026-08-07")).toBeNull();
  });
});

describe("budgetsForToday", () => {
  it("returns the allotments that can fund an expense dated today", () => {
    expect(budgetsForToday([week1, daily, weekend], NOW).map((b) => b.id)).toEqual([
      "b2",
    ]);
  });

  it("always includes a general allotment", () => {
    expect(
      budgetsForToday([week1, weekend, emergency], NOW).map((b) => b.id),
    ).toEqual(["b4"]);
  });

  it("is empty when nothing applies", () => {
    expect(budgetsForToday([week1, weekend], NOW)).toEqual([]);
  });
});

describe("general allotments", () => {
  it("recognises two nulls as no date restriction", () => {
    expect(isGeneralBudget(emergency)).toBe(true);
    expect(isGeneralBudget(week1)).toBe(false);
  });

  it("classifies each shape of allotment", () => {
    expect(budgetApplicability(emergency)).toBe("general");
    expect(budgetApplicability(daily)).toBe("single");
    expect(budgetApplicability(week1)).toBe("range");
  });

  it("covers every date, however far from the others", () => {
    for (const date of ["2026-08-03", "2026-08-10", "2026-08-19", "2027-09-01"]) {
      expect(coversDate(emergency, date)).toBe(true);
    }
  });

  it("still restricts a dated allotment", () => {
    expect(coversDate(week1, "2026-08-03")).toBe(true);
    expect(coversDate(week1, "2026-08-06")).toBe(false);
  });

  it("never has its period end as the calendar moves", () => {
    const distantFuture = new Date(2099, 0, 1);
    expect(isPeriodEnded(emergency, distantFuture)).toBe(false);
    expect(budgetStatus(emergency, [], distantFuture)).toBe("unrestricted");
  });

  it("still reports overspending", () => {
    const over = [expense("o", "b4", "Hospital", 12_000, "2026-08-19")];
    expect(budgetStatus(emergency, over, NOW)).toBe("over-budget");
  });

  it("has no duration to report", () => {
    expect(summarizeBudget(emergency, [], NOW).durationDays).toBeNull();
    expect(summarizeBudget(emergency, [], NOW).applicability).toBe("general");
  });

  it("labels the missing period rather than leaving it blank", () => {
    expect(describeBudgetPeriod(emergency)).toBe("No Date Restriction");
    expect(describeBudgetPeriod(daily)).not.toBe("");
  });

  it("can be listed on its own", () => {
    expect(generalBudgets([week1, daily, emergency]).map((b) => b.id)).toEqual([
      "b4",
    ]);
  });

  it("keeps its own balance, untouched by other allotments", () => {
    const mixed = [
      ...expenses,
      expense("g1", "b4", "Medicine", 1_000, "2026-08-19"),
    ];
    expect(calculateBudgetRemaining(emergency, mixed)).toBe(9_000);
    expect(calculateBudgetRemaining(week1, mixed)).toBe(3_200);
  });

  it("strands nothing when a dated budget becomes general", () => {
    const own = [expense("x", "b1", "Food", 100, "2026-08-01")];
    expect(
      expensesOutsidePeriod(week1, own, { startDate: null, endDate: null }),
    ).toEqual([]);
  });

  it("is not reported as an overlap, since it applies to every day", () => {
    expect(findOverlaps([emergency], "2026-08-01", "2026-08-05")).toEqual([]);
  });
});

describe("needsReassignment", () => {
  it("is true when the chosen budget cannot fund the new date", () => {
    expect(needsReassignment(week1, "2026-08-20")).toBe(true);
  });

  it("is false while the budget still covers the date", () => {
    expect(needsReassignment(week1, "2026-08-03")).toBe(false);
  });

  it("is never true for a general allotment", () => {
    expect(needsReassignment(emergency, "2027-01-01")).toBe(false);
  });

  it("is false when nothing is selected yet", () => {
    expect(needsReassignment(null, "2026-08-03")).toBe(false);
  });
});

describe("findOverlaps", () => {
  const budgets = [week1, daily, weekend];

  it("finds a clashing period and the days it shares", () => {
    const conflicts = findOverlaps(budgets, "2026-08-04", "2026-08-06");
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].budget.id).toBe("b1");
    expect(conflicts[0].start).toBe("2026-08-04");
    expect(conflicts[0].end).toBe("2026-08-05");
  });

  it("treats a shared endpoint as an overlap", () => {
    expect(findOverlaps(budgets, "2026-08-05", "2026-08-05")).toHaveLength(1);
  });

  it("allows a period that starts the day after another ends", () => {
    expect(findOverlaps([week1], "2026-08-06", "2026-08-10")).toEqual([]);
  });

  it("does not report a budget against itself when editing", () => {
    expect(findOverlaps(budgets, "2026-08-01", "2026-08-05", "b1")).toEqual([]);
  });

  it("reports nothing when there are no budgets", () => {
    expect(findOverlaps([], "2026-08-01", "2026-08-05")).toEqual([]);
  });
});

describe("expensesOutsidePeriod", () => {
  it("finds expenses a narrower period would strand", () => {
    const stranded = expensesOutsidePeriod(week1, expenses, {
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    expect(stranded.map((e) => e.id)).toEqual(["e3"]);
  });

  it("finds none when the period still covers them", () => {
    expect(
      expensesOutsidePeriod(week1, expenses, {
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      }),
    ).toEqual([]);
  });
});

describe("orphanedExpenses", () => {
  it("finds expenses whose budget is gone", () => {
    const orphans = orphanedExpenses([daily], expenses);
    expect(orphans).toHaveLength(3);
  });
});

describe("sortBudgetsByPeriod", () => {
  it("puts the newest period first", () => {
    const sorted = sortBudgetsByPeriod([week1, weekend, daily]);
    expect(sorted.map((b) => b.id)).toEqual(["b3", "b2", "b1"]);
  });

  it("does not mutate the input", () => {
    const input = [week1, weekend];
    sortBudgetsByPeriod(input);
    expect(input[0].id).toBe("b1");
  });
});
