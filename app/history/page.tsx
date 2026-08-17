import type { Metadata } from "next";

import { HistoryView } from "@/components/history/HistoryView";

export const metadata: Metadata = {
  title: "History · Expense Tracker",
  description:
    "Review previously recorded tracker days and export them as a PDF report.",
};

export default function HistoryPage() {
  return (
    <main className="min-h-dvh">
      <HistoryView />
    </main>
  );
}
