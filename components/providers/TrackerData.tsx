import type { ReactNode } from "react";

import { TrackerProvider } from "@/components/providers/TrackerProvider";
import { requireUserId } from "@/lib/server/session";
import { loadTrackerData } from "@/lib/db/tracker";
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
  const { budgets, expenses } = await loadTrackerData(userId);

  return (
    <TrackerProvider initialBudgets={budgets} initialExpenses={expenses}>
      {children}
    </TrackerProvider>
  );
}
