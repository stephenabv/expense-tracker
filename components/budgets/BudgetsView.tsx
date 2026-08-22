"use client";

import { useMemo, useState } from "react";

import type { Budget } from "@/types/budget";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BudgetCard } from "@/components/budgets/BudgetCard";
import { BudgetDetailModal } from "@/components/budgets/BudgetDetailModal";
import { BudgetFormModal } from "@/components/budgets/BudgetFormModal";
import { MergeBudgetsModal } from "@/components/budgets/MergeBudgetsModal";
import { formatCurrency } from "@/lib/currency";
import { sumAmounts } from "@/lib/calculations";
import type { BudgetMergeSource, BudgetSummary } from "@/types/budget";
import {
  budgetsFundedBy,
  isTransferred,
  MERGED_LABEL,
  totalAllotted,
} from "@/lib/budgets";

function BudgetsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4 pb-16">
      <span className="sr-only">Loading your budgets…</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-44 animate-pulse rounded-2xl border border-border-subtle bg-surface"
        />
      ))}
    </div>
  );
}

/** Create, review and manage every budget allotment. */
export function BudgetsView() {
  const {
    hydrated,
    budgets,
    activeBudgetSummaries,
    completedBudgetSummaries,
    mergedBudgetSummaries,
    merges,
    deleteBudget,
    isBudgetImmutable,
    getBudgetSummary,
  } = useTracker();

  /** Names for the "Transferred from …" line on a destination card. */
  const nameOf = (id: string | null) =>
    id ? budgets.find((entry) => entry.id === id)?.name : undefined;

  /*
   * Whether deleting this allotment is even possible.
   *
   * A transfer has two sides. Deleting the destination would make the money
   * deducted from the source vanish rather than come back; deleting the source
   * would leave the destination funded by nothing. The server refuses both, so
   * the card does not offer a control that could only ever fail.
   */
  const canDelete = (candidate: Budget) =>
    !isTransferred(candidate) && budgetsFundedBy(budgets, candidate.id).length === 0;
  const { showToast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  /**
   * The allotments picked for a merge.
   *
   * Selection mode is a separate state rather than a permanent pair of
   * checkboxes: merging is rare next to viewing and editing, and leaving
   * checkboxes on every card all the time would make the ordinary case noisier
   * for the sake of the unusual one.
   */
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [viewing, setViewing] = useState<Budget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Budget | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const toggleSelected = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : // Never more than two: the confirmation has to show one sum, and a
          // three-way merge is a different operation with different arithmetic.
          current.length >= 2
          ? current
          : [...current, id],
    );

  const stopSelecting = () => {
    setSelecting(false);
    setSelectedIds([]);
  };

  const chosen = selectedIds
    .map((id) => activeBudgetSummaries.find((entry) => entry.budget.id === id))
    .filter((entry): entry is BudgetSummary => entry !== undefined);

  const pair: [BudgetSummary, BudgetSummary] | null =
    chosen.length === 2 ? [chosen[0], chosen[1]] : null;

  const openEdit = (budget: Budget) => {
    setEditing(budget);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteBudget(pendingDelete.id);
    showToast(`${pendingDelete.name} deleted`);
    setPendingDelete(null);
  };

  /*
   * The headline figures describe the open allotments only.
   *
   * A fully spent budget has ₱0.00 left by definition, so folding it in would
   * drag "remaining" down with money that was never available — the number is
   * meant to answer "what can I still spend?", and a closed budget answers
   * nothing.
   *
   * Transferred allotments are left out of the *allotted* figure for a
   * different reason: their pesos were already counted in the budget they came
   * from, so adding them again would report more money than the user ever had.
   * The remaining balances still add up normally — the source's fell by exactly
   * what the destination's rose.
   */
  const allotted = totalAllotted(
    activeBudgetSummaries.map((summary) => summary.budget),
  );
  const totalRemaining = sumAmounts(
    activeBudgetSummaries.map((summary) => summary.remaining),
  );
  const hasAny =
    activeBudgetSummaries.length +
      completedBudgetSummaries.length +
      mergedBudgetSummaries.length >
    0;

  /** What each merged allotment held when it was folded in, by source id. */
  const snapshots = useMemo(() => {
    const map = new Map<string, BudgetMergeSource>();
    for (const merge of merges) {
      for (const source of merge.sources) map.set(source.sourceBudgetId, source);
    }
    return map;
  }, [merges]);

  if (!hydrated) {
    return (
      <AppShell>
        <BudgetsSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 pb-16 sm:space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
              Budget Allotments
            </h2>
            {activeBudgetSummaries.length > 0 ? (
              <p className="mt-0.5 text-[0.8125rem] text-muted">
                <span className="tabular">{formatCurrency(allotted)}</span>{" "}
                allotted ·{" "}
                <span className="tabular">{formatCurrency(totalRemaining)}</span>{" "}
                remaining
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Offered only when there is actually a pair to choose from. */}
            {activeBudgetSummaries.length > 1 ? (
              <Button
                variant="secondary"
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              >
                {selecting ? "Cancel Merge" : "Merge Budgets"}
              </Button>
            ) : null}

            {selecting ? null : (
              <Button onClick={openCreate}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  className="h-4 w-4"
                >
                  <path d="M10 4.5v11M4.5 10h11" />
                </svg>
                Add Allotment
              </Button>
            )}
          </div>
        </div>

        {/* A standing instruction while choosing, so the rule is visible rather
            than discovered by clicking a third card and nothing happening. */}
        {selecting ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-strong bg-surface-muted p-3.5">
            <p className="text-[0.8125rem] text-muted-strong">
              {chosen.length === 0
                ? "Choose two allotments to merge."
                : chosen.length === 1
                  ? `${chosen[0].budget.name} selected — choose one more.`
                  : `${chosen[0].budget.name} + ${chosen[1].budget.name}`}
            </p>
            <Button size="sm" disabled={pair === null} onClick={() => setMergeOpen(true)}>
              Merge Selected
            </Button>
          </div>
        ) : null}

        {!hasAny ? (
          <div className="flex flex-col items-center rounded-2xl border border-border-subtle bg-surface px-6 py-14 text-center shadow-card">
            <div
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted ring-1 ring-inset ring-border-subtle"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-muted"
              >
                <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z" />
                <path d="M4 10h16" />
              </svg>
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">
              No budget allotments yet
            </h3>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Create one for a day, a weekend or a whole month. Each allotment
              keeps its own balance.
            </p>
            <Button onClick={openCreate} className="mt-5">
              Create your first budget
            </Button>
          </div>
        ) : activeBudgetSummaries.length === 0 ? (
          // Every allotment has been spent out. Saying so beats an empty grid,
          // and points at the only thing left to do.
          <div className="rounded-2xl border border-border-subtle bg-surface px-6 py-10 text-center shadow-card">
            <h3 className="text-base font-semibold text-foreground">
              No active allotments
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              Everything you have budgeted is fully spent. Create a new allotment
              to keep recording expenses.
            </p>
            <Button onClick={openCreate} className="mt-5">
              Add Allotment
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {activeBudgetSummaries.map((summary) => (
              <BudgetCard
                key={summary.budget.id}
                summary={summary}
                sourceName={nameOf(summary.budget.sourceBudgetId)}
                immutable={isBudgetImmutable(summary.budget)}
                deletable={canDelete(summary.budget)}
                selection={
                  selecting
                    ? {
                        selected: selectedIds.includes(summary.budget.id),
                        disabled:
                          selectedIds.length >= 2 &&
                          !selectedIds.includes(summary.budget.id),
                        onToggle: () => toggleSelected(summary.budget.id),
                      }
                    : undefined
                }
                onView={() => setViewing(summary.budget)}
                onEdit={() => openEdit(summary.budget)}
                onDelete={() => setPendingDelete(summary.budget)}
              />
            ))}
          </div>
        )}

        {activeBudgetSummaries.length > 0 ? (
          <p className="text-[0.8125rem] text-muted">
            Allotments whose period has ended are locked so past reports stay
            accurate. Create a new budget for a new period instead of reopening
            an old one.
          </p>
        ) : null}

        {/*
         * Merged allotments get their own section, apart from the fully spent
         * ones. Both are closed and locked, but they are not the same thing: one
         * was spent out, the other had its money moved into another allotment,
         * and lumping them together would suggest the money is gone when it is
         * not.
         */}
        {mergedBudgetSummaries.length > 0 ? (
          <section aria-labelledby="merged-budgets-heading" className="pt-2">
            <h2
              id="merged-budgets-heading"
              className="text-[0.9375rem] font-semibold tracking-tight text-foreground"
            >
              {MERGED_LABEL} Allotments
            </h2>
            <p className="mt-1 text-[0.8125rem] text-muted">
              Folded into another allotment. Their expenses moved with them and
              are kept in full; these remain as records of what they held.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {mergedBudgetSummaries.map((summary) => (
                <BudgetCard
                  key={summary.budget.id}
                  summary={summary}
                  sourceName={nameOf(summary.budget.sourceBudgetId)}
                  mergedIntoName={nameOf(summary.budget.mergedIntoBudgetId)}
                  snapshot={snapshots.get(summary.budget.id)}
                  immutable
                  onView={() => setViewing(summary.budget)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/*
         * Completed allotments live in their own section rather than mixed into
         * the list above. They cannot be spent against, edited or deleted, so
         * leaving them among the working budgets would offer choices that are
         * not choices.
         */}
        {completedBudgetSummaries.length > 0 ? (
          <section aria-labelledby="completed-budgets-heading" className="pt-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2
                id="completed-budgets-heading"
                className="text-[0.9375rem] font-semibold tracking-tight text-foreground"
              >
                Completed Budgets
              </h2>
              <p className="text-[0.8125rem] text-muted">
                <span className="tabular">
                  {formatCurrency(
                    totalAllotted(
                      completedBudgetSummaries.map((entry) => entry.budget),
                    ),
                  )}
                </span>{" "}
                fully spent across{" "}
                {completedBudgetSummaries.length === 1
                  ? "1 allotment"
                  : `${completedBudgetSummaries.length} allotments`}
              </p>
            </div>

            <p className="mt-1 text-[0.8125rem] text-muted">
              Spent down to {formatCurrency(0)} and locked. These and their
              expenses are kept as a permanent record and can no longer be
              changed.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {completedBudgetSummaries.map((summary) => (
                <BudgetCard
                  key={summary.budget.id}
                  summary={summary}
                  sourceName={nameOf(summary.budget.sourceBudgetId)}
                  immutable
                  onView={() => setViewing(summary.budget)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <BudgetFormModal
        open={formOpen}
        budget={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <MergeBudgetsModal
        open={mergeOpen && pair !== null}
        sources={pair}
        onClose={() => {
          setMergeOpen(false);
          stopSelecting();
        }}
      />

      <BudgetDetailModal
        open={viewing !== null}
        budget={viewing}
        onClose={() => setViewing(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this budget?"
        description="Its expenses are deleted with it. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      >
        {pendingDelete ? (
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{pendingDelete.name}</span>{" "}
            has {getBudgetSummary(pendingDelete.id)?.expenseCount ?? 0} recorded
            expense
            {(getBudgetSummary(pendingDelete.id)?.expenseCount ?? 0) === 1
              ? ""
              : "s"}.
          </p>
        ) : null}
      </ConfirmDialog>
    </AppShell>
  );
}
