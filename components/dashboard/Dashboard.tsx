"use client";

import Link from "next/link";
import { useState } from "react";

import type { Budget } from "@/types/budget";
import { useTracker } from "@/components/providers/TrackerProvider";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { BudgetDetailModal } from "@/components/budgets/BudgetDetailModal";
import { BudgetFormModal } from "@/components/budgets/BudgetFormModal";
import { BudgetOverview } from "@/components/dashboard/BudgetOverview";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { AddExpenseButton } from "@/components/expenses/AddExpenseButton";
import { AddExpenseModal } from "@/components/expenses/AddExpenseModal";
import { ExpenseList } from "@/components/expenses/ExpenseList";
import { CURRENCY_SYMBOL } from "@/lib/currency";

/** First run: nothing exists yet, so ask for one budget and nothing else. */
function Welcome({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-[65dvh] flex-col justify-center pb-16">
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-card sm:p-8">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-muted text-lg font-semibold text-foreground ring-1 ring-inset ring-border-subtle"
        >
          {CURRENCY_SYMBOL}
        </span>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          Create your first budget
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          A budget allotment is an independent source of funds. Give it a day, a
          date range, or no date at all — then choose which allotment each
          expense comes out of.
        </p>

        <Button onClick={onCreate} className="mt-6 w-full">
          Create Budget Allotment
        </Button>
      </div>
    </div>
  );
}

/**
 * Composes the tracker screen.
 *
 * There is deliberately no single "Current Balance" here. Several allotments
 * can be available at once, and adding their balances together would produce a
 * figure the user cannot spend: ₱3,200 of food money and ₱8,000 of emergency
 * money is not ₱11,200 of anything. Each allotment is reported on its own row,
 * and selecting one opens its detail.
 */
export function Dashboard() {
  const {
    hydrated,
    budgets,
    activeBudgetSummaries,
    completedBudgetSummaries,
    todaysBudgets,
  } = useTracker();

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [budgetFormOpen, setBudgetFormOpen] = useState(false);
  const [budgetSeedDate, setBudgetSeedDate] = useState<string | undefined>();
  const [viewing, setViewing] = useState<Budget | null>(null);

  const openBudgetForm = (date?: string) => {
    setBudgetSeedDate(date);
    setAddExpenseOpen(false);
    setBudgetFormOpen(true);
  };

  if (!hydrated) {
    return (
      <AppShell>
        <DashboardSkeleton />
      </AppShell>
    );
  }

  if (budgets.length === 0) {
    return (
      <>
        <AppShell>
          <Welcome onCreate={() => openBudgetForm()} />
        </AppShell>
        <BudgetFormModal
          open={budgetFormOpen}
          initialDate={budgetSeedDate}
          onClose={() => setBudgetFormOpen(false)}
        />
      </>
    );
  }

  const availableIds = new Set(todaysBudgets.map((budget) => budget.id));
  const completedCount = completedBudgetSummaries.length;

  return (
    <>
      <AppShell>
        {/* Bottom padding clears the floating action button. */}
        <div className="space-y-4 pb-32 sm:space-y-5">
          <BudgetOverview
            summaries={activeBudgetSummaries}
            availableIds={availableIds}
            onSelect={setViewing}
          />

          {/*
           * Closed allotments are not listed here, only pointed at.
           *
           * This screen answers one question — what can I spend right now —
           * and a ₱0.00 row answers it with a no. The full record lives on the
           * budgets screen, which already lists completed and merged
           * allotments with their totals; this line is the way back to it, so
           * they are out of the way without being hidden.
           */}
          {completedCount > 0 ? (
            <p className="px-1 text-[0.8125rem] text-muted">
              {completedCount === 1
                ? "1 completed allotment is"
                : `${completedCount} completed allotments are`}{" "}
              kept on the{" "}
              <Link
                href="/budgets"
                className="rounded font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                budgets screen
              </Link>
              .
            </p>
          ) : null}

          <ExpenseList
            onAddExpense={() => setAddExpenseOpen(true)}
            onCreateBudget={openBudgetForm}
          />
        </div>
      </AppShell>

      <AddExpenseButton onClick={() => setAddExpenseOpen(true)} />

      <AddExpenseModal
        open={addExpenseOpen}
        onClose={() => setAddExpenseOpen(false)}
        onCreateBudget={openBudgetForm}
      />

      <BudgetFormModal
        open={budgetFormOpen}
        initialDate={budgetSeedDate}
        onClose={() => setBudgetFormOpen(false)}
      />

      <BudgetDetailModal
        open={viewing !== null}
        budget={viewing}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
