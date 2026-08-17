import { describe, expect, it } from "vitest";

import {
  validateBudget,
  validateExpenseAmount,
  validateExpenseForm,
  validateExpenseName,
} from "@/lib/validation";
import { MAX_AMOUNT } from "@/lib/currency";

describe("validateBudget", () => {
  it("accepts a plain number", () => {
    expect(validateBudget("13000")).toEqual({ ok: true, value: 13_000 });
  });

  it("accepts formatted input", () => {
    expect(validateBudget(" ₱13,000.50 ")).toEqual({ ok: true, value: 13_000.5 });
  });

  it("accepts zero", () => {
    expect(validateBudget("0").ok).toBe(true);
  });

  it("rejects an empty value", () => {
    expect(validateBudget("   ").ok).toBe(false);
  });

  it("rejects non-numeric text", () => {
    expect(validateBudget("abc").ok).toBe(false);
    expect(validateBudget("1e9").ok).toBe(false);
  });

  it("rejects negatives", () => {
    expect(validateBudget("-5").ok).toBe(false);
  });

  it("rejects values above the maximum", () => {
    expect(validateBudget(String(MAX_AMOUNT + 1)).ok).toBe(false);
  });
});

describe("validateExpenseName", () => {
  it("trims and accepts a name", () => {
    expect(validateExpenseName("  Food  ")).toEqual({ ok: true, value: "Food" });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateExpenseName("").ok).toBe(false);
    expect(validateExpenseName("    ").ok).toBe(false);
  });

  it("rejects an overly long name", () => {
    expect(validateExpenseName("x".repeat(61)).ok).toBe(false);
  });
});

describe("validateExpenseAmount", () => {
  it("accepts a positive amount", () => {
    expect(validateExpenseAmount("500")).toEqual({ ok: true, value: 500 });
  });

  it("rejects zero and negatives", () => {
    expect(validateExpenseAmount("0").ok).toBe(false);
    expect(validateExpenseAmount("-10").ok).toBe(false);
  });

  it("rejects invalid text", () => {
    expect(validateExpenseAmount("abc").ok).toBe(false);
    expect(validateExpenseAmount(".").ok).toBe(false);
  });

  it("blocks an expense larger than the available balance", () => {
    const result = validateExpenseAmount("1000", { availableBalance: 500 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("₱500.00");
  });

  it("allows an expense exactly equal to the available balance", () => {
    expect(validateExpenseAmount("500", { availableBalance: 500 }).ok).toBe(true);
  });

  it("allows overspending when overdraft is enabled", () => {
    const result = validateExpenseAmount("1000", {
      availableBalance: 500,
      allowOverdraft: true,
    });
    expect(result).toEqual({ ok: true, value: 1_000 });
  });

  it("skips the balance check when no balance is supplied", () => {
    expect(validateExpenseAmount("1000000").ok).toBe(true);
  });

  it("rejects amounts above the maximum", () => {
    expect(validateExpenseAmount("1000000000000").ok).toBe(false);
  });
});

describe("validateExpenseForm", () => {
  it("returns both values when everything is valid", () => {
    const result = validateExpenseForm("Food", "500", { availableBalance: 1_000 });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ name: "Food", amount: 500 });
  });

  it("reports every field error at once", () => {
    const result = validateExpenseForm("", "-1");
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.amount).toBeDefined();
  });

  it("reports the overspend error on the amount field", () => {
    const result = validateExpenseForm("Rent", "5000", { availableBalance: 100 });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeUndefined();
    expect(result.errors.amount).toContain("available balance");
  });
});
