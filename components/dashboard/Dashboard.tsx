"use client";

import { useState } from "react";

import { useTracker } from "@/components/providers/TrackerProvider";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { BudgetFormModal } from "@/components/budgets/BudgetFormModal";
import { BudgetOverview } from "@/components/dashboard/BudgetOverview";
import { CurrentBudgetCard } from "@/components/dashboard/CurrentBudgetCard";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { AddExpenseButton } from "@/components/expenses/AddExpenseButton";
import { AddExpenseModal } from "@/components/expenses/AddExpenseModal";
import { ExpenseList } from "@/components/expenses/ExpenseList";
import { formatDateKey, todayKey } from "@/lib/dates";
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
          A budget allotment is one financial period — a day, a weekend, a whole
          month — with its own amount. Expenses are charged to the allotment
          covering their date.
        </p>

        <Button onClick={onCreate} className="mt-6 w-full">
          Add Budget Allotment
        </Button>
      </div>
    </div>
  );
}

/** No allotment covers today, though others exist for other periods. */
function NoBudgetToday({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-7">
      <p className="text-[0.8125rem] font-medium tracking-wide text-muted">
        Current Budget
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
        No budget covers today
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Nothing is allotted for {formatDateKey(todayKey())}. Create a budget for
        today to start recording expenses against it.
      </p>
      <Button onClick={onCreate} className="mt-5">
        Add Budget Allotment
      </Button>
    </section>
  );
}

/** Composes the tracker screen. */
export function Dashboard() {
  const { hydrated, budgets, budgetSummaries, currentBudget, getBudgetSummary } =
    useTracker();

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [budgetFormOpen, setBudgetFormOpen] = useState(false);
  const [budgetSeedDate, setBudgetSeedDate] = useState<string | undefined>();

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

  const currentSummary = currentBudget ? getBudgetSummary(currentBudget.id) : null;

  return (
    <>
      <AppShell>
        {/* Bottom padding clears the floating action button. */}
        <div className="space-y-4 pb-32 sm:space-y-5">
          {currentSummary ? (
            <CurrentBudgetCard summary={currentSummary} />
          ) : (
            <NoBudgetToday onCreate={() => openBudgetForm()} />
          )}

          <BudgetOverview
            summaries={budgetSummaries}
            currentBudgetId={currentBudget?.id}
          />

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
    </>
  );
}
