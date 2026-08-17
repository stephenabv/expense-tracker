"use client";

import { useTracker } from "@/components/providers/TrackerProvider";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/currency";

/** Total spend and expense count — the two remaining headline figures. */
export function ExpenseSummary() {
  const { totals } = useTracker();
  const { totalExpenses, expenseCount, budget } = totals;

  const share =
    budget > 0 ? Math.round((totalExpenses / budget) * 100) : null;

  return (
    <>
      <StatCard
        label="Total Expenses"
        value={formatCurrency(totalExpenses)}
        caption={
          share !== null ? `${share}% of your budget` : "No budget set yet"
        }
      />

      <StatCard
        label="Expenses"
        value={expenseCount}
        caption={
          expenseCount === 0
            ? "Nothing recorded yet"
            : expenseCount === 1
              ? "1 entry recorded"
              : `${expenseCount} entries recorded`
        }
      />
    </>
  );
}
