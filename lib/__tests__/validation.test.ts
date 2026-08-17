import { describe, expect, it } from "vitest";

import {
  validateBudgetAmount,
  validateBudgetForm,
  validateBudgetName,
  validateBudgetPeriod,
  validateExpenseAmount,
  validateExpenseDate,
  validateExpenseForm,
  validateExpenseName,
} from "@/lib/validation";
import { MAX_AMOUNT } from "@/lib/currency";
import { budget } from "./helpers";

const week1 = budget("b1", "August Week 1", 5_000, "2026-08-01", "2026-08-05");
const daily = budget("b2", "Daily Budget", 1_000, "2026-08-06");

describe("validateBudgetName", () => {
  it("trims and accepts a custom name", () => {
    expect(validateBudgetName("  Vacation Fund  ")).toEqual({
      ok: true,
      value: "Vacation Fund",
    });
  });

  it("rejects an empty name rather than generating one", () => {
    expect(validateBudgetName("").ok).toBe(false);
    expect(validateBudgetName("   ").error).toMatch(/name/i);
  });

  it("rejects an overly long name", () => {
    expect(validateBudgetName("x".repeat(41)).ok).toBe(false);
  });
});

describe("validateBudgetAmount", () => {
  it("accepts plain and formatted numbers", () => {
    expect(validateBudgetAmount("5000")).toEqual({ ok: true, value: 5_000 });
    expect(validateBudgetAmount(" ₱5,000.50 ")).toEqual({ ok: true, value: 5_000.5 });
  });

  it("accepts zero", () => {
    expect(validateBudgetAmount("0").ok).toBe(true);
  });

  it("rejects empty, non-numeric and negative values", () => {
    expect(validateBudgetAmount("").ok).toBe(false);
    expect(validateBudgetAmount("abc").ok).toBe(false);
    expect(validateBudgetAmount("1e9").ok).toBe(false);
    expect(validateBudgetAmount("-5").ok).toBe(false);
  });

  it("rejects values above the maximum", () => {
    expect(validateBudgetAmount(String(MAX_AMOUNT + 1)).ok).toBe(false);
  });
});

describe("validateBudgetPeriod", () => {
  it("accepts a date range", () => {
    expect(validateBudgetPeriod("2026-08-01", "2026-08-05").ok).toBe(true);
  });

  it("accepts a single-day period", () => {
    const result = validateBudgetPeriod("2026-08-18", "2026-08-18");
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ startDate: "2026-08-18", endDate: "2026-08-18" });
  });

  it("rejects a start after the end", () => {
    expect(validateBudgetPeriod("2026-08-06", "2026-08-05").error).toMatch(
      /on or before/,
    );
  });

  it("rejects malformed dates", () => {
    expect(validateBudgetPeriod("nope", "2026-08-05").ok).toBe(false);
  });
});

describe("validateBudgetForm", () => {
  it("accepts a valid, non-overlapping budget", () => {
    const result = validateBudgetForm("Weekend", "3000", "2026-08-07", "2026-08-09", {
      budgets: [week1, daily],
    });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      name: "Weekend",
      amount: 3_000,
      startDate: "2026-08-07",
      endDate: "2026-08-09",
    });
  });

  it("reports every field error at once", () => {
    const result = validateBudgetForm("", "-1", "2026-08-09", "2026-08-01");
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.amount).toBeDefined();
    expect(result.errors.period).toBeDefined();
  });

  it("rejects a period overlapping an existing budget", () => {
    const result = validateBudgetForm("Clash", "1000", "2026-08-04", "2026-08-06", {
      budgets: [week1, daily],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.period).toContain("August Week 1");
  });

  it("rejects an overlap of a single shared day", () => {
    const result = validateBudgetForm("Clash", "1000", "2026-08-05", "2026-08-05", {
      budgets: [week1],
    });
    expect(result.ok).toBe(false);
  });

  it("allows a period starting the day after another ends", () => {
    const result = validateBudgetForm("Next", "1000", "2026-08-06", "2026-08-10", {
      budgets: [week1],
    });
    expect(result.ok).toBe(true);
  });

  it("does not conflict a budget with itself while editing", () => {
    const result = validateBudgetForm("August Week 1", "6000", "2026-08-01", "2026-08-05", {
      budgets: [week1, daily],
      excludeId: "b1",
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateExpenseName", () => {
  it("trims and accepts a name", () => {
    expect(validateExpenseName("  Food  ")).toEqual({ ok: true, value: "Food" });
  });

  it("rejects an empty name", () => {
    expect(validateExpenseName("   ").ok).toBe(false);
  });

  it("rejects an overly long name", () => {
    expect(validateExpenseName("x".repeat(61)).ok).toBe(false);
  });
});

describe("validateExpenseAmount", () => {
  it("accepts a positive amount", () => {
    expect(validateExpenseAmount("500")).toEqual({ ok: true, value: 500 });
  });

  it("rejects zero, negatives and junk", () => {
    expect(validateExpenseAmount("0").ok).toBe(false);
    expect(validateExpenseAmount("-10").ok).toBe(false);
    expect(validateExpenseAmount("abc").ok).toBe(false);
  });

  it("blocks an expense larger than the budget's balance", () => {
    const result = validateExpenseAmount("1000", { availableBalance: 500 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("₱500.00");
  });

  it("allows an amount exactly equal to the balance", () => {
    expect(validateExpenseAmount("500", { availableBalance: 500 }).ok).toBe(true);
  });

  it("allows overspending when overdraft is enabled", () => {
    expect(
      validateExpenseAmount("1000", { availableBalance: 500, allowOverdraft: true }).ok,
    ).toBe(true);
  });
});

describe("validateExpenseDate", () => {
  it("accepts a covered date", () => {
    expect(validateExpenseDate("2026-08-03", [week1]).ok).toBe(true);
  });

  it("rejects a date no budget covers", () => {
    const result = validateExpenseDate("2026-08-20", []);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No budget/);
  });

  it("rejects a malformed date", () => {
    expect(validateExpenseDate("nope", [week1]).ok).toBe(false);
  });
});

describe("validateExpenseForm", () => {
  it("accepts a valid expense", () => {
    const result = validateExpenseForm("Groceries", "500", "2026-08-03", "b1", {
      applicableBudgets: [week1],
      availableBalance: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      name: "Groceries",
      amount: 500,
      expenseDate: "2026-08-03",
      budgetId: "b1",
    });
  });

  it("reports every field error at once", () => {
    const result = validateExpenseForm("", "-1", "2026-08-20", "", {
      applicableBudgets: [],
    });
    expect(result.errors.name).toBeDefined();
    expect(result.errors.amount).toBeDefined();
    expect(result.errors.expenseDate).toBeDefined();
  });

  it("refuses a budget that does not cover the date", () => {
    const result = validateExpenseForm("Food", "100", "2026-08-03", "b2", {
      applicableBudgets: [week1],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.budgetId).toMatch(/does not cover/);
  });

  it("requires a choice when several budgets apply", () => {
    const result = validateExpenseForm("Food", "100", "2026-08-03", "", {
      applicableBudgets: [week1, daily],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.budgetId).toMatch(/Choose which budget/);
  });

  it("blocks an expense that would overspend its budget", () => {
    const result = validateExpenseForm("Rent", "5000", "2026-08-06", "b2", {
      applicableBudgets: [daily],
      availableBalance: 1_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.amount).toContain("available balance");
  });
});
