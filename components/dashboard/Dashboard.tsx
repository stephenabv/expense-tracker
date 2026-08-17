"use client";

import { useState } from "react";

import { useTracker } from "@/components/providers/TrackerProvider";
import { BalanceCard } from "@/components/dashboard/BalanceCard";
import { BudgetCard } from "@/components/dashboard/BudgetCard";
import { BudgetSetup } from "@/components/dashboard/BudgetSetup";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { ExpenseSummary } from "@/components/dashboard/ExpenseSummary";
import { AddExpenseButton } from "@/components/expenses/AddExpenseButton";
import { AddExpenseModal } from "@/components/expenses/AddExpenseModal";
import { ExpenseList } from "@/components/expenses/ExpenseList";

/** Composes the screen and decides between first-run, loading and tracking. */
export function Dashboard() {
  const { hydrated, budget } = useTracker();
  const [addOpen, setAddOpen] = useState(false);

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10">
      {children}
    </div>
  );

  if (!hydrated) return shell(<DashboardSkeleton />);

  if (budget === null) return shell(<BudgetSetup />);

  return (
    <>
      {shell(
        // Bottom padding clears the floating action button.
        <div className="pb-32">
          <header className="mb-5 flex items-baseline justify-between gap-3 sm:mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Expense Tracker
            </h1>
            <p className="text-[0.8125rem] text-muted">Philippine Peso</p>
          </header>

          <div className="space-y-4 sm:space-y-5">
            <BalanceCard />

            {/* Budget spans the full width on phones; the two smaller metrics
                pair up beneath it, then all three sit in a row on wider screens. */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
              <BudgetCard />
              <ExpenseSummary />
            </div>

            <ExpenseList onAddExpense={() => setAddOpen(true)} />
          </div>
        </div>,
      )}

      <AddExpenseButton onClick={() => setAddOpen(true)} />
      <AddExpenseModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
