import Link from "next/link";
import type { ReactNode } from "react";

import { CURRENCY_SYMBOL } from "@/lib/currency";

/** Centred frame shared by every authentication screen. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-card sm:p-8">
        <Link
          href="/"
          aria-label="Expense Tracker"
          className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-base font-semibold text-background"
          >
            {CURRENCY_SYMBOL}
          </span>
          <span className="text-sm font-medium text-muted">Expense Tracker</span>
        </Link>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
        ) : null}

        <div className="mt-6">{children}</div>
      </div>

      {footer ? (
        <div className="mt-5 text-center text-sm text-muted">{footer}</div>
      ) : null}
    </main>
  );
}
