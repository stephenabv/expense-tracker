import type { Metadata } from "next";

import { BudgetsView } from "@/components/budgets/BudgetsView";

export const metadata: Metadata = {
  title: "Budgets · Expense Tracker",
  description: "Create and manage budget allotments for different periods.",
};

export default function BudgetsPage() {
  return (
    <main className="min-h-dvh">
      <BudgetsView />
    </main>
  );
}
