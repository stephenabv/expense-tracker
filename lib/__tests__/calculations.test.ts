import { describe, expect, it } from "vitest";

import {
  calculateAvailableBalance,
  calculateBalance,
  calculateTotalExpenses,
  calculateTotals,
  sortExpensesByNewest,
} from "@/lib/calculations";
import type { Expense } from "@/types/expense";

function expense(
  id: string,
  name: string,
  amount: number,
  createdAt = "2026-01-01T00:00:00.000Z",
): Expense {
  return { id, name, amount, createdAt };
}

describe("calculateTotalExpenses", () => {
  it("returns zero for an empty list", () => {
    expect(calculateTotalExpenses([])).toBe(0);
  });

  it("sums amounts", () => {
    const expenses = [
      expense("1", "Food", 500),
      expense("2", "Transportation", 300),
    ];
    expect(calculateTotalExpenses(expenses)).toBe(800);
  });

  it("stays exact across many fractional amounts", () => {
    const expenses = Array.from({ length: 10 }, (_, index) =>
      expense(String(index), "Coffee", 0.1),
    );
    expect(calculateTotalExpenses(expenses)).toBe(1);
  });

  it("ignores records with a non-numeric amount", () => {
    const expenses = [
      expense("1", "Food", 500),
      { ...expense("2", "Broken", 0), amount: Number.NaN },
    ];
    expect(calculateTotalExpenses(expenses)).toBe(500);
  });
});

describe("calculateBalance", () => {
  it("applies the core business rule", () => {
    expect(calculateBalance(13_000, 500)).toBe(12_500);
  });

  it("goes negative when spending exceeds the budget", () => {
    expect(calculateBalance(500, 1_000)).toBe(-500);
  });

  it("handles a zero budget", () => {
    expect(calculateBalance(0, 0)).toBe(0);
  });

  it("survives non-finite inputs", () => {
    expect(calculateBalance(Number.NaN, 100)).toBe(-100);
    expect(calculateBalance(100, Number.POSITIVE_INFINITY)).toBe(100);
  });
});

describe("calculateTotals", () => {
  it("derives the whole dashboard from budget and expenses", () => {
    const totals = calculateTotals({
      budget: 13_000,
      expenses: [expense("1", "Food", 500), expense("2", "Transport", 300)],
    });

    expect(totals.budget).toBe(13_000);
    expect(totals.totalExpenses).toBe(800);
    expect(totals.currentBalance).toBe(12_200);
    expect(totals.expenseCount).toBe(2);
    expect(totals.isOverspent).toBe(false);
  });

  it("treats a missing budget as zero", () => {
    const totals = calculateTotals({ budget: null, expenses: [] });
    expect(totals.budget).toBe(0);
    expect(totals.currentBalance).toBe(0);
    expect(totals.spentRatio).toBe(0);
  });

  it("does not divide by a zero budget", () => {
    const totals = calculateTotals({
      budget: 0,
      expenses: [expense("1", "Food", 500)],
    });
    expect(totals.spentRatio).toBe(0);
    expect(totals.isOverspent).toBe(true);
  });

  it("clamps the spent ratio to one when overspent", () => {
    const totals = calculateTotals({
      budget: 100,
      expenses: [expense("1", "Rent", 400)],
    });
    expect(totals.spentRatio).toBe(1);
    expect(totals.currentBalance).toBe(-300);
  });

  it("handles very large values without losing precision", () => {
    const totals = calculateTotals({
      budget: 999_999_999_999.99,
      expenses: [expense("1", "Yacht", 0.99)],
    });
    expect(totals.currentBalance).toBe(999_999_999_999);
  });
});

describe("calculateAvailableBalance", () => {
  const state = {
    budget: 1_000,
    expenses: [expense("1", "Food", 400), expense("2", "Taxi", 100)],
  };

  it("matches the current balance when nothing is excluded", () => {
    expect(calculateAvailableBalance(state)).toBe(500);
  });

  it("adds back the expense being edited", () => {
    expect(calculateAvailableBalance(state, "1")).toBe(900);
  });

  it("ignores an unknown id", () => {
    expect(calculateAvailableBalance(state, "nope")).toBe(500);
  });
});

describe("sortExpensesByNewest", () => {
  it("puts the newest expense first", () => {
    const sorted = sortExpensesByNewest([
      expense("1", "Old", 10, "2026-01-01T10:00:00.000Z"),
      expense("2", "New", 10, "2026-01-03T10:00:00.000Z"),
      expense("3", "Middle", 10, "2026-01-02T10:00:00.000Z"),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(["New", "Middle", "Old"]);
  });

  it("does not mutate the input", () => {
    const input = [
      expense("1", "Old", 10, "2026-01-01T10:00:00.000Z"),
      expense("2", "New", 10, "2026-01-03T10:00:00.000Z"),
    ];
    sortExpensesByNewest(input);
    expect(input[0].name).toBe("Old");
  });

  it("orders deterministically when timestamps are unparseable", () => {
    const sorted = sortExpensesByNewest([
      expense("a", "A", 10, "not-a-date"),
      expense("b", "B", 10, "also-not-a-date"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
