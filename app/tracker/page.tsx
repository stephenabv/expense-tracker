import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard/Dashboard";
import { TrackerData } from "@/components/providers/TrackerData";

export const metadata: Metadata = { title: "Tracker · Expense Tracker" };

/**
 * Per-user data, resolved from the session on every request — never prerendered
 * and never cached across accounts.
 */
export const dynamic = "force-dynamic";

export default function TrackerPage() {
  return (
    <main className="min-h-dvh">
      <TrackerData>
        <Dashboard />
      </TrackerData>
    </main>
  );
}
