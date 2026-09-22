/**
 * Filing merged allotments under the budget that holds their money.
 *
 * The record of a merge is shown beneath the allotment the money ended up in,
 * so the grouping has one job: put every folded-in allotment somewhere, exactly
 * once. These tests protect that — including for a chain of merges, and for the
 * corrupted shapes the walk must not hang on.
 */

import { describe, expect, it } from "vitest";

import { groupMergedSources, summarizeBudget } from "@/lib/budgets";
import type { Budget, BudgetMerge, BudgetMergeSource } from "@/types/budget";
import { budget } from "./helpers";

const MERGED_AT = "2026-08-12T00:00:00.000Z";

/** An allotment that was folded into `destination`. */
function foldedInto(
  id: string,
  name: string,
  amount: number,
  destination: string,
  mergedAt = MERGED_AT,
): Budget {
  return budget(id, name, amount, null, null, {
    status: "merged",
    mergedIntoBudgetId: destination,
    mergedAt,
  });
}

function snapshotOf(source: Budget, spent: number): BudgetMergeSource {
  return {
    sourceBudgetId: source.id,
    sourceName: source.name,
    amount: source.amount,
    totalExpenses: spent,
    totalTransferred: 0,
    remaining: source.amount - spent,
  };
}

function mergeOf(
  mergedBudgetId: string,
  sources: BudgetMergeSource[],
  mergedAt = MERGED_AT,
): BudgetMerge {
  const totalExpenses = sources.reduce((sum, entry) => sum + entry.totalExpenses, 0);
  return {
    mergedBudgetId,
    mergedAt,
    sources,
    totalAmount: sources.reduce((sum, entry) => sum + entry.amount, 0),
    totalExpenses,
    totalTransferred: 0,
    totalRemaining: sources.reduce((sum, entry) => sum + entry.remaining, 0),
  };
}

const summarize = (entry: Budget) => summarizeBudget(entry, []);

describe("groupMergedSources", () => {
  const destination = budget("dest", "ATM Withdrawals", 4_900, null);
  const first = foldedInto("src1", "ATM Withdrawal", 4_400, destination.id);
  const second = foldedInto("src2", "500 ATM Withdrawal", 500, destination.id);
  const merges = [
    mergeOf(destination.id, [snapshotOf(first, 4_056.04), snapshotOf(second, 0)]),
  ];

  it("files both sources under the allotment they were folded into", () => {
    const { byDestination, orphans } = groupMergedSources(
      [first, second].map(summarize),
      merges,
      new Set([destination.id]),
    );

    expect(orphans).toEqual([]);
    expect(byDestination.get(destination.id)?.map((node) => node.summary.budget.id)).toEqual([
      "src1",
      "src2",
    ]);
  });

  it("carries each source's snapshot, not its emptied live figures", () => {
    const { byDestination } = groupMergedSources(
      [first, second].map(summarize),
      merges,
      new Set([destination.id]),
    );

    const [node] = byDestination.get(destination.id) ?? [];
    // The live summary reads ₱0 spent once the expenses have moved out.
    expect(node.summary.totalExpenses).toBe(0);
    expect(node.snapshot?.totalExpenses).toBe(4_056.04);
    expect(node.snapshot?.remaining).toBeCloseTo(343.96, 2);
  });

  it("leaves the snapshot null when the merge record is missing", () => {
    const { byDestination } = groupMergedSources(
      [first].map(summarize),
      [],
      new Set([destination.id]),
    );

    expect(byDestination.get(destination.id)?.[0].snapshot).toBeNull();
  });

  it("nests a chain of merges under the allotment that survives", () => {
    // first + second → inner, then inner + other → outer.
    const inner = foldedInto("inner", "ATM Withdrawals", 4_900, "outer", MERGED_AT);
    const other = foldedInto("other", "Groceries", 1_000, "outer", MERGED_AT);
    const innerFirst = foldedInto("src1", "ATM Withdrawal", 4_400, inner.id);
    const innerSecond = foldedInto("src2", "500 ATM Withdrawal", 500, inner.id);

    const { byDestination, orphans } = groupMergedSources(
      [inner, other, innerFirst, innerSecond].map(summarize),
      [
        mergeOf(inner.id, [snapshotOf(innerFirst, 4_056.04), snapshotOf(innerSecond, 0)]),
        mergeOf("outer", [snapshotOf(inner, 4_056.04), snapshotOf(other, 250)]),
      ],
      new Set(["outer"]),
    );

    expect(orphans).toEqual([]);
    const top = byDestination.get("outer") ?? [];
    expect(top.map((node) => node.summary.budget.id)).toEqual(["inner", "other"]);
    // The inner merge's own sources hang off its row rather than the page.
    expect(top[0].sources.map((node) => node.summary.budget.id)).toEqual(["src1", "src2"]);
    expect(top[1].sources).toEqual([]);
    // And never twice: nothing folded into `inner` is listed at the top level.
    expect(byDestination.has(inner.id)).toBe(false);
  });

  it("lists sources whose destination is nowhere on screen", () => {
    const { byDestination, orphans } = groupMergedSources(
      [first, second].map(summarize),
      merges,
      new Set(["some-other-budget"]),
    );

    expect(byDestination.size).toBe(0);
    expect(orphans.map((node) => node.summary.budget.id)).toEqual(["src1", "src2"]);
  });

  it("still shows an allotment merged into itself, without recursing forever", () => {
    const looped = foldedInto("loop", "Looped", 100, "loop");

    const { orphans } = groupMergedSources([looped].map(summarize), [], new Set(["dest"]));

    expect(orphans.map((node) => node.summary.budget.id)).toEqual(["loop"]);
    expect(orphans[0].sources[0].summary.budget.id).toBe("loop");
    expect(orphans[0].sources[0].sources).toEqual([]);
  });

  it("lists a pair of allotments merged into each other rather than dropping them", () => {
    const left = foldedInto("left", "Left", 100, "right");
    const right = foldedInto("right", "Right", 200, "left");

    const { byDestination, orphans } = groupMergedSources(
      [left, right].map(summarize),
      [],
      new Set(["dest"]),
    );

    expect(byDestination.size).toBe(0);
    expect(orphans.map((node) => node.summary.budget.id)).toEqual(["left"]);
    expect(orphans[0].sources.map((node) => node.summary.budget.id)).toEqual(["right"]);
  });
});
