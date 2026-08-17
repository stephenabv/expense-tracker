import { describe, expect, it } from "vitest";

import { EMPTY_STATE, parseStoredState, serializeState } from "@/lib/storage";

describe("parseStoredState", () => {
  it("returns the empty state when storage is empty", () => {
    expect(parseStoredState(null)).toEqual(EMPTY_STATE);
    expect(parseStoredState("")).toEqual(EMPTY_STATE);
  });

  it("returns the empty state for corrupted JSON", () => {
    expect(parseStoredState("{not json")).toEqual(EMPTY_STATE);
    expect(parseStoredState("null")).toEqual(EMPTY_STATE);
    expect(parseStoredState('"a string"')).toEqual(EMPTY_STATE);
    expect(parseStoredState("[1,2,3]")).toEqual(EMPTY_STATE);
  });

  it("round-trips valid state", () => {
    const state = {
      budget: 13_000,
      expenses: [
        {
          id: "abc",
          name: "Food",
          amount: 500,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    expect(parseStoredState(serializeState(state))).toEqual(state);
  });

  it("keeps good records and drops broken ones", () => {
    const raw = JSON.stringify({
      version: 1,
      budget: 1_000,
      expenses: [
        { id: "1", name: "Food", amount: 500, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "2", name: "Broken", amount: "not a number" },
        null,
        { id: "3", name: "Zero", amount: 0, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });

    const state = parseStoredState(raw);
    expect(state.budget).toBe(1_000);
    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0].name).toBe("Food");
  });

  it("repairs a missing name and timestamp rather than discarding the amount", () => {
    const raw = JSON.stringify({ budget: 100, expenses: [{ id: "1", amount: 25 }] });
    const state = parseStoredState(raw);

    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0].name).toBe("Untitled expense");
    expect(Number.isNaN(Date.parse(state.expenses[0].createdAt))).toBe(false);
  });

  it("normalises a negative stored amount", () => {
    const raw = JSON.stringify({ budget: 100, expenses: [{ id: "1", name: "Odd", amount: -25 }] });
    expect(parseStoredState(raw).expenses[0].amount).toBe(25);
  });

  it("drops duplicate ids", () => {
    const raw = JSON.stringify({
      budget: 100,
      expenses: [
        { id: "dup", name: "First", amount: 10 },
        { id: "dup", name: "Second", amount: 20 },
      ],
    });
    const state = parseStoredState(raw);
    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0].name).toBe("First");
  });

  it("treats an invalid budget as unset", () => {
    expect(parseStoredState(JSON.stringify({ budget: "abc", expenses: [] })).budget).toBeNull();
    expect(parseStoredState(JSON.stringify({ budget: -50, expenses: [] })).budget).toBeNull();
    expect(parseStoredState(JSON.stringify({ expenses: [] })).budget).toBeNull();
  });

  it("keeps a zero budget", () => {
    expect(parseStoredState(JSON.stringify({ budget: 0, expenses: [] })).budget).toBe(0);
  });

  it("tolerates a non-array expenses field", () => {
    expect(parseStoredState(JSON.stringify({ budget: 10, expenses: "oops" })).expenses).toEqual([]);
  });
});
