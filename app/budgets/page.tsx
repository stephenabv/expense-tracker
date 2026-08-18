import type { Metadata } from "next";

import { BudgetsView } from "@/components/budgets/BudgetsView";
import { TrackerData } from "@/components/providers/TrackerData";

export const metadata: Metadata = {
  title: "Budgets · Expense Tracker",
  description: "Create and manage budget allotments for different periods.",
};

/**
 * Per-user data, resolved from the session on every request — never prerendered
 * and never cached across accounts.
 */
export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  return (
    <main className="min-h-dvh">
      <TrackerData>
        <BudgetsView />
      </TrackerData>
    </main>
  );
}
