import { describe, expect, it } from "vitest";

import {
  EMPTY_DATA,
  migrateLegacyData,
  parseStoredData,
  serializeData,
} from "@/lib/storage";

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
      budget: 13_000,
      expenses: [
        {
          id: "abc",
          name: "Food",
          amount: 500,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      history: [
        {
          date: "2026-01-01",
          budget: 13_000,
          startingBalance: 13_000,
          endingBalance: 12_500,
          totalExpenses: 500,
          expenses: [
            {
              id: "abc",
              name: "Food",
              amount: 500,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    };
    expect(parseStoredData(serializeData(data))).toEqual(data);
  });

  it("keeps good records and drops broken ones", () => {
    const raw = JSON.stringify({
      version: 2,
      budget: 1_000,
      expenses: [
        { id: "1", name: "Food", amount: 500, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "2", name: "Broken", amount: "not a number" },
        null,
        { id: "3", name: "Zero", amount: 0, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });

    const data = parseStoredData(raw);
    expect(data.budget).toBe(1_000);
    expect(data.expenses).toHaveLength(1);
    expect(data.expenses[0].name).toBe("Food");
  });

  it("repairs a missing name and timestamp rather than discarding the amount", () => {
    const raw = JSON.stringify({ budget: 100, expenses: [{ id: "1", amount: 25 }] });
    const data = parseStoredData(raw);

    expect(data.expenses).toHaveLength(1);
    expect(data.expenses[0].name).toBe("Untitled expense");
    expect(Number.isNaN(Date.parse(data.expenses[0].createdAt))).toBe(false);
  });

  it("normalises a negative stored amount", () => {
    const raw = JSON.stringify({ budget: 100, expenses: [{ id: "1", name: "Odd", amount: -25 }] });
    expect(parseStoredData(raw).expenses[0].amount).toBe(25);
  });

  it("drops duplicate ids", () => {
    const raw = JSON.stringify({
      budget: 100,
      expenses: [
        { id: "dup", name: "First", amount: 10 },
        { id: "dup", name: "Second", amount: 20 },
      ],
    });
    const data = parseStoredData(raw);
    expect(data.expenses).toHaveLength(1);
    expect(data.expenses[0].name).toBe("First");
  });

  it("treats an invalid budget as unset", () => {
    expect(parseStoredData(JSON.stringify({ budget: "abc", expenses: [] })).budget).toBeNull();
    expect(parseStoredData(JSON.stringify({ budget: -50, expenses: [] })).budget).toBeNull();
    expect(parseStoredData(JSON.stringify({ expenses: [] })).budget).toBeNull();
  });

  it("keeps a zero budget", () => {
    expect(parseStoredData(JSON.stringify({ budget: 0, expenses: [] })).budget).toBe(0);
  });

  it("tolerates a non-array expenses field", () => {
    expect(parseStoredData(JSON.stringify({ budget: 10, expenses: "oops" })).expenses).toEqual([]);
  });
});

describe("parseStoredData — history", () => {
  it("defaults history to empty when absent", () => {
    expect(parseStoredData(JSON.stringify({ budget: 10, expenses: [] })).history).toEqual([]);
  });

  it("drops records without a usable date", () => {
    const raw = JSON.stringify({
      budget: 100,
      expenses: [],
      history: [
        { date: "not-a-date", budget: 100, expenses: [] },
        { budget: 100, expenses: [] },
        { date: "2026-01-01", budget: 100, startingBalance: 100, endingBalance: 90, totalExpenses: 10, expenses: [] },
      ],
    });
    const { history } = parseStoredData(raw);
    expect(history).toHaveLength(1);
    expect(history[0].date).toBe("2026-01-01");
  });

  it("trusts recorded budgets and balances as written", () => {
    const raw = JSON.stringify({
      budget: 50,
      expenses: [],
      history: [
        {
          date: "2026-01-01",
          budget: 13_000,
          startingBalance: 13_000,
          endingBalance: 12_500,
          totalExpenses: 500,
          expenses: [{ id: "a", name: "Food", amount: 500, createdAt: "2026-01-01T02:00:00.000Z" }],
        },
      ],
    });

    const day = parseStoredData(raw).history[0];
    // The live budget is 50, but the snapshot keeps the 13,000 it recorded.
    expect(day.budget).toBe(13_000);
    expect(day.endingBalance).toBe(12_500);
  });

  it("rebuilds missing figures from the record's own expenses", () => {
    const raw = JSON.stringify({
      budget: 100,
      expenses: [],
      history: [
        {
          date: "2026-01-02",
          budget: 1_000,
          expenses: [
            { id: "a", name: "Food", amount: 200, createdAt: "2026-01-02T02:00:00.000Z" },
            { id: "b", name: "Taxi", amount: 100, createdAt: "2026-01-02T03:00:00.000Z" },
          ],
        },
      ],
    });

    const day = parseStoredData(raw).history[0];
    expect(day.totalExpenses).toBe(300);
    expect(day.endingBalance).toBe(700);
    expect(day.startingBalance).toBe(1_000);
  });

  it("keeps one record per date and sorts oldest first", () => {
    const raw = JSON.stringify({
      budget: 100,
      expenses: [],
      history: [
        { date: "2026-01-03", budget: 100, startingBalance: 100, endingBalance: 100, totalExpenses: 0, expenses: [] },
        { date: "2026-01-01", budget: 100, startingBalance: 100, endingBalance: 100, totalExpenses: 0, expenses: [] },
        { date: "2026-01-03", budget: 200, startingBalance: 200, endingBalance: 200, totalExpenses: 0, expenses: [] },
      ],
    });

    const { history } = parseStoredData(raw);
    expect(history.map((day) => day.date)).toEqual(["2026-01-01", "2026-01-03"]);
    expect(history[1].budget).toBe(200);
  });

  it("tolerates a non-array history field", () => {
    expect(parseStoredData(JSON.stringify({ budget: 10, expenses: [], history: 5 })).history).toEqual([]);
  });
});

describe("migrateLegacyData", () => {
  const now = new Date("2026-08-17T12:00:00");

  it("returns null when there is nothing to migrate", () => {
    expect(migrateLegacyData(null, now)).toBeNull();
    expect(migrateLegacyData(JSON.stringify({ budget: null, expenses: [] }), now)).toBeNull();
  });

  it("carries a v1 tracker forward and backfills history", () => {
    const legacy = JSON.stringify({
      version: 1,
      budget: 13_000,
      expenses: [
        { id: "a", name: "Food", amount: 500, createdAt: "2026-08-16T04:30:00.000Z" },
        { id: "b", name: "Taxi", amount: 300, createdAt: "2026-08-17T04:30:00.000Z" },
      ],
    });

    const migrated = migrateLegacyData(legacy, now);

    expect(migrated).not.toBeNull();
    expect(migrated!.budget).toBe(13_000);
    expect(migrated!.expenses).toHaveLength(2);
    expect(migrated!.history).toHaveLength(2);
    // Balances chain across days rather than restarting each day.
    expect(migrated!.history[0].endingBalance).toBe(12_500);
    expect(migrated!.history[1].endingBalance).toBe(12_200);
  });
});
