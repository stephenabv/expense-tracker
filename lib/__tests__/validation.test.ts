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
import { budget, generalBudget } from "./helpers";

const week1 = budget("b1", "August Week 1", 5_000, "2026-08-01", "2026-08-05");
const daily = budget("b2", "Daily Budget", 1_000, "2026-08-06");
const emergency = generalBudget("b4", "Emergency Fund", 10_000);

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
    expect(validateBudgetPeriod("range", "2026-08-01", "2026-08-05").ok).toBe(true);
  });

  it("accepts a single-day period and mirrors the date to both ends", () => {
    const result = validateBudgetPeriod("single", "2026-08-18", "");
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ startDate: "2026-08-18", endDate: "2026-08-18" });
  });

  it("stores a general allotment as two nulls", () => {
    const result = validateBudgetPeriod("general", "", "");
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ startDate: null, endDate: null });
  });

  it("discards dates left over from another mode", () => {
    // The user typed dates, then switched to "no specific date": keeping them
    // would silently restrict an allotment the user asked to be unrestricted.
    const result = validateBudgetPeriod("general", "2026-08-01", "2026-08-05");
    expect(result.value).toEqual({ startDate: null, endDate: null });
  });

  it("rejects a start after the end", () => {
    expect(validateBudgetPeriod("range", "2026-08-06", "2026-08-05").error).toMatch(
      /on or before/,
    );
  });

  it("rejects malformed dates", () => {
    expect(validateBudgetPeriod("range", "nope", "2026-08-05").ok).toBe(false);
    expect(validateBudgetPeriod("single", "nope", "").ok).toBe(false);
  });
});

describe("validateBudgetForm", () => {
  it("accepts a date-range budget", () => {
    const result = validateBudgetForm("Weekend", "3000", "range", "2026-08-07", "2026-08-09");
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      name: "Weekend",
      amount: 3_000,
      startDate: "2026-08-07",
      endDate: "2026-08-09",
    });
  });

  it("accepts a single-day budget", () => {
    const result = validateBudgetForm("Allowance", "1000", "single", "2026-08-06", "");
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      name: "Allowance",
      amount: 1_000,
      startDate: "2026-08-06",
      endDate: "2026-08-06",
    });
  });

  it("accepts a budget with no date restriction", () => {
    const result = validateBudgetForm("Emergency Fund", "10000", "general", "", "");
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      name: "Emergency Fund",
      amount: 10_000,
      startDate: null,
      endDate: null,
    });
  });

  it("reports every field error at once", () => {
    const result = validateBudgetForm("", "-1", "range", "2026-08-09", "2026-08-01");
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.amount).toBeDefined();
    expect(result.errors.period).toBeDefined();
  });

  it("rejects an invalid range", () => {
    expect(
      validateBudgetForm("Backwards", "1000", "range", "2026-08-09", "2026-08-01").ok,
    ).toBe(false);
  });

  it("still validates the name and amount of a general budget", () => {
    expect(validateBudgetForm("", "1000", "general", "", "").ok).toBe(false);
    expect(validateBudgetForm("Fund", "abc", "general", "", "").ok).toBe(false);
    expect(validateBudgetForm("Fund", "-5", "general", "", "").ok).toBe(false);
  });

  it("allows an overlapping period, because each expense names its budget", () => {
    // The old no-overlap rule existed to keep date→budget resolution
    // unambiguous. Expenses now carry a budget id, so the overlap is a choice
    // rather than a contradiction — and a general allotment overlaps everything.
    const result = validateBudgetForm("Clash", "1000", "range", "2026-08-04", "2026-08-06");
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

  it("rejects a date no allotment can fund", () => {
    const result = validateExpenseDate("2026-08-20", []);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No budget allotment is available/);
  });

  it("accepts any date once a general allotment exists", () => {
    expect(validateExpenseDate("2026-12-25", [emergency]).ok).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(validateExpenseDate("nope", [week1]).ok).toBe(false);
  });
});

describe("validateExpenseForm", () => {
  it("accepts a valid expense", () => {
    const result = validateExpenseForm("Groceries", "500", "2026-08-03", "b1", {
      eligibleBudgets: [week1],
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
      eligibleBudgets: [],
    });
    expect(result.errors.name).toBeDefined();
    expect(result.errors.amount).toBeDefined();
    expect(result.errors.expenseDate).toBeDefined();
  });

  it("refuses a budget that does not cover the date", () => {
    const result = validateExpenseForm("Food", "100", "2026-08-03", "b2", {
      eligibleBudgets: [week1],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.budgetId).toMatch(/not available for the selected date/);
  });

  it("requires a choice when several budgets apply", () => {
    const result = validateExpenseForm("Food", "100", "2026-08-03", "", {
      eligibleBudgets: [week1, daily],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.budgetId).toMatch(/Choose which budget allotment/);
  });

  it("blocks an expense that would overspend its budget", () => {
    const result = validateExpenseForm("Rent", "5000", "2026-08-06", "b2", {
      eligibleBudgets: [daily],
      availableBalance: 1_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.amount).toContain("available balance");
  });

  it("accepts an expense charged to a general allotment", () => {
    const result = validateExpenseForm("Medicine", "1000", "2026-09-30", "b4", {
      eligibleBudgets: [emergency],
      availableBalance: 10_000,
    });
    expect(result.ok).toBe(true);
    expect(result.values?.budgetId).toBe("b4");
  });

  it("requires a choice between a dated and a general allotment", () => {
    const result = validateExpenseForm("Food", "100", "2026-08-03", "", {
      eligibleBudgets: [week1, emergency],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.budgetId).toBeDefined();
  });

  it("refuses a budget id that was never offered", () => {
    // The server passes only this user's eligible budgets, so an id belonging
    // to another account — or to a budget for an unrelated date — lands here.
    const result = validateExpenseForm("Food", "100", "2026-08-03", "someone-else", {
      eligibleBudgets: [week1, emergency],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.budgetId).toBeDefined();
  });

  it("measures the amount against the chosen allotment's own balance", () => {
    // Same expense, same date, two eligible pots: only the chosen one matters.
    expect(
      validateExpenseForm("Medicine", "5000", "2026-08-03", "b4", {
        eligibleBudgets: [week1, emergency],
        availableBalance: 10_000,
      }).ok,
    ).toBe(true);

    expect(
      validateExpenseForm("Medicine", "5000", "2026-08-03", "b1", {
        eligibleBudgets: [week1, emergency],
        availableBalance: 200,
      }).ok,
    ).toBe(false);
  });
});
