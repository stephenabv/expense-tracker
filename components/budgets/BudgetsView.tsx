"use client";

import { useState } from "react";

import type { Budget } from "@/types/budget";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BudgetCard } from "@/components/budgets/BudgetCard";
import { BudgetDetailModal } from "@/components/budgets/BudgetDetailModal";
import { BudgetFormModal } from "@/components/budgets/BudgetFormModal";
import { formatCurrency } from "@/lib/currency";
import { sumAmounts } from "@/lib/calculations";

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
  const { hydrated, budgetSummaries, deleteBudget, isBudgetCompleted, getBudgetSummary } =
    useTracker();
  const { showToast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [viewing, setViewing] = useState<Budget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Budget | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

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

  const totalAllotted = sumAmounts(
    budgetSummaries.map((summary) => summary.budget.amount),
  );
  const totalRemaining = sumAmounts(
    budgetSummaries.map((summary) => summary.remaining),
  );

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
            {budgetSummaries.length > 0 ? (
              <p className="mt-0.5 text-[0.8125rem] text-muted">
                <span className="tabular">{formatCurrency(totalAllotted)}</span>{" "}
                allotted ·{" "}
                <span className="tabular">{formatCurrency(totalRemaining)}</span>{" "}
                remaining
              </p>
            ) : null}
          </div>

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
        </div>

        {budgetSummaries.length === 0 ? (
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
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {budgetSummaries.map((summary) => (
              <BudgetCard
                key={summary.budget.id}
                summary={summary}
                immutable={isBudgetCompleted(summary.budget)}
                onView={() => setViewing(summary.budget)}
                onEdit={() => openEdit(summary.budget)}
                onDelete={() => setPendingDelete(summary.budget)}
              />
            ))}
          </div>
        )}

        {budgetSummaries.length > 0 ? (
          <p className="text-[0.8125rem] text-muted">
            Completed allotments are locked so past reports stay accurate. Create
            a new budget for a new period instead of reopening an old one.
          </p>
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
