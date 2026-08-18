import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { SetupRequired } from "@/components/layout/SetupRequired";
import { requireUserId } from "@/lib/server/session";
import { findUserById } from "@/lib/db/users";
import { isDatabaseConfigured } from "@/lib/db/client";
import { GENDER_LABELS, type Gender } from "@/lib/auth/schemas";
import { LOGIN_ROUTE } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Profile · Expense Tracker" };

/**
 * Per-user data, resolved from the session on every request — never prerendered
 * and never cached across accounts.
 */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  if (!isDatabaseConfigured()) return <SetupRequired />;

  const userId = await requireUserId();
  const user = await findUserById(userId);
  if (!user) redirect(LOGIN_ROUTE);

  const rows: Array<{ label: string; value: string }> = [
    { label: "Name", value: user.name },
    { label: "Gender", value: GENDER_LABELS[user.gender as Gender] ?? "—" },
    { label: "Email", value: user.email },
    {
      label: "Email verified",
      value: user.emailVerifiedAt
        ? user.emailVerifiedAt.toLocaleDateString("en-PH", {
            dateStyle: "long",
          })
        : "Not verified",
    },
    {
      label: "Member since",
      value: user.createdAt.toLocaleDateString("en-PH", { dateStyle: "long" }),
    },
  ];

  return (
    <main className="min-h-dvh">
      <AppShell>
        <div className="space-y-4 pb-16 sm:space-y-5">
          <section className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
            <h2 className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
              Your account
            </h2>

            <dl className="mt-4 space-y-3">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-3 last:border-0 last:pb-0"
                >
                  <dt className="text-sm text-muted">{row.label}</dt>
                  <dd className="text-[0.9375rem] font-medium text-foreground">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
            <h2 className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
              Session
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Logging out clears your session cookie on this device.
            </p>
            <div className="mt-4 sm:max-w-48">
              <SignOutButton />
            </div>
          </section>
        </div>
      </AppShell>
    </main>
  );
}
