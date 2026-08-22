import type { ReactNode } from "react";

import { TrackerProvider } from "@/components/providers/TrackerProvider";
import { requireUserId } from "@/lib/server/session";
import {
  budgetTotals,
  listBudgetMerges,
  listBudgets,
  listExpensesPage,
} from "@/lib/db/tracker";
import { isDatabaseConfigured } from "@/lib/db/client";
import { SetupRequired } from "@/components/layout/SetupRequired";

/**
 * Loads the signed-in user's tracker on the server and hands it to the client
 * provider.
 *
 * The user id comes from `requireUserId`, which reads the session cookie — so
 * the query is scoped to the caller before any component renders.
 */
export async function TrackerData({ children }: { children: ReactNode }) {
  if (!isDatabaseConfigured()) return <SetupRequired />;

  const userId = await requireUserId();

  // Four small queries rather than one unbounded one: the allotments, their
  // totals, what any merges folded together, and the first page of expenses.
  // Nothing here grows with the number of expenses the account has recorded.
  const [budgets, totals, merges, firstPage] = await Promise.all([
    listBudgets(userId),
    budgetTotals(userId),
    listBudgetMerges(userId),
    listExpensesPage(userId, { page: 1 }),
  ]);

  return (
    <TrackerProvider
      initialBudgets={budgets}
      initialMerges={merges}
      initialTotals={totals}
      initialExpenses={firstPage.data}
      initialPagination={firstPage.pagination}
    >
      {children}
    </TrackerProvider>
  );
}
