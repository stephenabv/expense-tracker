"use client";

import { useState } from "react";

import { useTracker } from "@/components/providers/TrackerProvider";
import { AppShell } from "@/components/layout/AppShell";
import { BalanceCard } from "@/components/dashboard/BalanceCard";
import { BudgetCard } from "@/components/dashboard/BudgetCard";
import { BudgetSetup } from "@/components/dashboard/BudgetSetup";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { ExpenseSummary } from "@/components/dashboard/ExpenseSummary";
import { AddExpenseButton } from "@/components/expenses/AddExpenseButton";
import { AddExpenseModal } from "@/components/expenses/AddExpenseModal";
import { ExpenseList } from "@/components/expenses/ExpenseList";

/** Composes the tracker screen and picks between first-run, loading and active. */
export function Dashboard() {
  const { hydrated, budget } = useTracker();
  const [addOpen, setAddOpen] = useState(false);

  if (!hydrated) {
    return (
      <AppShell>
        <DashboardSkeleton />
      </AppShell>
    );
  }

  if (budget === null) {
    return (
      <AppShell>
        <BudgetSetup />
      </AppShell>
    );
  }

  return (
    <>
      <AppShell>
        {/* Bottom padding clears the floating action button. */}
        <div className="space-y-4 pb-32 sm:space-y-5">
          <BalanceCard />

          {/* Budget spans the full width on phones; the two smaller metrics
              pair up beneath it, then all three sit in a row on wider screens. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
            <BudgetCard />
            <ExpenseSummary />
          </div>

          <ExpenseList onAddExpense={() => setAddOpen(true)} />
        </div>
      </AppShell>

      <AddExpenseButton onClick={() => setAddOpen(true)} />
      <AddExpenseModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
