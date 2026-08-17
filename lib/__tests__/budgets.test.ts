import { describe, expect, it } from "vitest";

import {
  activeBudget,
  budgetStatus,
  budgetsForDate,
  calculateBudgetRemaining,
  expensesForBudget,
  expensesOutsidePeriod,
  findOverlaps,
  isCompleted,
  orphanedExpenses,
  resolveBudgetForDate,
  sortBudgetsByPeriod,
  summarizeBudget,
} from "@/lib/budgets";
import { budget, expense } from "./helpers";

const NOW = new Date(2026, 7, 6, 12, 0); // 6 August 2026

const week1 = budget("b1", "August Week 1", 5_000, "2026-08-01", "2026-08-05");
const daily = budget("b2", "Daily Budget", 1_000, "2026-08-06");
const weekend = budget("b3", "Weekend Budget", 3_000, "2026-08-07", "2026-08-09");

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
    expect(budgetStatus(week1, expenses, NOW)).toBe("completed");
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

describe("isCompleted", () => {
  it("is true only after the period ends", () => {
    expect(isCompleted(week1, NOW)).toBe(true);
    expect(isCompleted(daily, NOW)).toBe(false);
    expect(isCompleted(week1, new Date(2026, 7, 5))).toBe(false);
  });
});

describe("summarizeBudget", () => {
  it("derives every figure from the budget's own expenses", () => {
    const summary = summarizeBudget(week1, expenses, NOW);
    expect(summary.totalExpenses).toBe(1_800);
    expect(summary.remaining).toBe(3_200);
    expect(summary.expenseCount).toBe(3);
    expect(summary.status).toBe("completed");
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

  it("refuses to choose when several budgets cover the date", () => {
    const overlapping = [
      budget("a", "A", 5_000, "2026-08-01", "2026-08-10"),
      budget("b", "B", 3_000, "2026-08-05", "2026-08-15"),
    ];
    expect(budgetsForDate(overlapping, "2026-08-07")).toHaveLength(2);
    expect(resolveBudgetForDate(overlapping, "2026-08-07")).toBeNull();
  });
});

describe("activeBudget", () => {
  it("returns the budget covering today", () => {
    expect(activeBudget([week1, daily, weekend], NOW)?.id).toBe("b2");
  });

  it("returns null when nothing covers today", () => {
    expect(activeBudget([week1, weekend], NOW)).toBeNull();
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
