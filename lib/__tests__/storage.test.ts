import { describe, expect, it } from "vitest";

import {
  EMPTY_DATA,
  MIGRATED_BUDGET_NAME,
  migrateLegacyData,
  parseStoredData,
  serializeData,
} from "@/lib/storage";
import { budget, expense } from "./helpers";

describe("parseStoredData", () => {
  it("returns the empty state when storage is empty", () => {
    expect(parseStoredData(null)).toEqual(EMPTY_DATA);
    expect(parseStoredData("")).toEqual(EMPTY_DATA);
  });

  it("returns the empty state for corrupted JSON", () => {
    expect(parseStoredData("{not json")).toEqual(EMPTY_DATA);
    expect(parseStoredData("null")).toEqual(EMPTY_DATA);
    expect(parseStoredData('"a string"')).toEqual(EMPTY_DATA);
    expect(parseStoredData("[1,2,3]")).toEqual(EMPTY_DATA);
  });

  it("round-trips valid data", () => {
    const data = {
      budgets: [budget("b1", "Food Budget", 5_000, "2026-08-01", "2026-08-05")],
      expenses: [expense("e1", "b1", "Food", 500, "2026-08-01")],
    };
    expect(parseStoredData(serializeData(data))).toEqual(data);
  });

  it("drops budgets without a usable period", () => {
    const raw = JSON.stringify({
      budgets: [
        { id: "ok", name: "Fine", amount: 100, startDate: "2026-08-01", endDate: "2026-08-02" },
        { id: "bad", name: "No dates", amount: 100 },
        { id: "bad2", name: "Junk", amount: 100, startDate: "nope", endDate: "nope" },
        null,
      ],
      expenses: [],
    });
    const data = parseStoredData(raw);
    expect(data.budgets).toHaveLength(1);
    expect(data.budgets[0].id).toBe("ok");
  });

  it("repairs a reversed period rather than discarding the budget", () => {
    const raw = JSON.stringify({
      budgets: [
        { id: "b", name: "Backwards", amount: 100, startDate: "2026-08-05", endDate: "2026-08-01" },
      ],
      expenses: [],
    });
    const stored = parseStoredData(raw).budgets[0];
    expect(stored.startDate).toBe("2026-08-01");
    expect(stored.endDate).toBe("2026-08-05");
  });

  it("drops expenses whose budget no longer exists", () => {
    const raw = JSON.stringify({
      budgets: [budget("b1", "Kept", 500, "2026-08-01", "2026-08-05")],
      expenses: [
        expense("e1", "b1", "Food", 100, "2026-08-01"),
        expense("e2", "gone", "Orphan", 100, "2026-08-01"),
      ],
    });
    const data = parseStoredData(raw);
    expect(data.expenses).toHaveLength(1);
    expect(data.expenses[0].id).toBe("e1");
  });

  it("drops expenses with no budget reference", () => {
    const raw = JSON.stringify({
      budgets: [budget("b1", "Kept", 500, "2026-08-01", "2026-08-05")],
      expenses: [{ id: "x", name: "No budget", amount: 100, expenseDate: "2026-08-01" }],
    });
    expect(parseStoredData(raw).expenses).toEqual([]);
  });

  it("falls back to the creation day when the expense date is missing", () => {
    const raw = JSON.stringify({
      budgets: [budget("b1", "Kept", 500, "1970-01-01", "2030-01-01")],
      expenses: [
        { id: "x", budgetId: "b1", name: "Legacy", amount: 100, createdAt: "2026-08-03T10:00:00.000Z" },
      ],
    });
    const stored = parseStoredData(raw).expenses[0];
    expect(stored.expenseDate).toMatch(/^2026-08-0[34]$/);
  });

  it("normalises a negative amount and drops a zero one", () => {
    const raw = JSON.stringify({
      budgets: [budget("b1", "Kept", 500, "2026-08-01", "2026-08-05")],
      expenses: [
        { id: "n", budgetId: "b1", name: "Odd", amount: -25, expenseDate: "2026-08-01" },
        { id: "z", budgetId: "b1", name: "Zero", amount: 0, expenseDate: "2026-08-01" },
      ],
    });
    const data = parseStoredData(raw);
    expect(data.expenses).toHaveLength(1);
    expect(data.expenses[0].amount).toBe(25);
  });

  it("drops duplicate ids", () => {
    const raw = JSON.stringify({
      budgets: [
        budget("dup", "First", 100, "2026-08-01"),
        budget("dup", "Second", 200, "2026-08-02"),
      ],
      expenses: [],
    });
    expect(parseStoredData(raw).budgets).toHaveLength(1);
  });

  it("defaults a budget to locked", () => {
    const raw = JSON.stringify({
      budgets: [
        { id: "b", name: "N", amount: 1, startDate: "2026-08-01", endDate: "2026-08-01" },
      ],
      expenses: [],
    });
    expect(parseStoredData(raw).budgets[0].locked).toBe(true);
  });

  it("tolerates non-array fields", () => {
    const raw = JSON.stringify({ budgets: "oops", expenses: 5 });
    expect(parseStoredData(raw)).toEqual(EMPTY_DATA);
  });
});

describe("migrateLegacyData", () => {
  const now = new Date(2026, 7, 17, 12, 0);

  it("returns null when there is nothing to migrate", () => {
    expect(migrateLegacyData(null, now)).toBeNull();
    expect(migrateLegacyData(JSON.stringify({ budget: null, expenses: [] }), now)).toBeNull();
    expect(migrateLegacyData("{broken", now)).toBeNull();
  });

  it("ignores a payload that is already multi-budget", () => {
    expect(migrateLegacyData(JSON.stringify({ budgets: [], expenses: [] }), now)).toBeNull();
  });

  it("turns a single-budget tracker into one allotment", () => {
    const legacy = JSON.stringify({
      version: 2,
      budget: 13_000,
      expenses: [
        { id: "a", name: "Food", amount: 500, createdAt: "2026-08-16T04:30:00.000Z" },
        { id: "b", name: "Taxi", amount: 300, createdAt: "2026-08-17T04:30:00.000Z" },
      ],
    });

    const migrated = migrateLegacyData(legacy, now)!;

    expect(migrated.budgets).toHaveLength(1);
    expect(migrated.budgets[0].name).toBe(MIGRATED_BUDGET_NAME);
    expect(migrated.budgets[0].amount).toBe(13_000);
    expect(migrated.expenses).toHaveLength(2);
  });

  it("attaches every migrated expense to the new budget", () => {
    const legacy = JSON.stringify({
      budget: 1_000,
      expenses: [{ id: "a", name: "Food", amount: 500, createdAt: "2026-08-16T04:30:00.000Z" }],
    });

    const migrated = migrateLegacyData(legacy, now)!;
    expect(migrated.expenses[0].budgetId).toBe(migrated.budgets[0].id);
  });

  it("spans the days the old tracker covered and stays open through today", () => {
    const legacy = JSON.stringify({
      budget: 1_000,
      expenses: [{ id: "a", name: "Old", amount: 10, createdAt: "2026-08-10T04:30:00.000Z" }],
    });

    const migrated = migrateLegacyData(legacy, now)!;
    expect(migrated.budgets[0].startDate <= "2026-08-10").toBe(true);
    expect(migrated.budgets[0].endDate).toBe("2026-08-17");
  });

  it("migrates a budget with no expenses", () => {
    const migrated = migrateLegacyData(JSON.stringify({ budget: 5_000, expenses: [] }), now)!;
    expect(migrated.budgets[0].amount).toBe(5_000);
    expect(migrated.expenses).toEqual([]);
  });
});
