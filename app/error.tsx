"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";

/**
 * Last line of defence.
 *
 * Your budgets and expenses live on the server, so nothing here is lost — this
 * screen offers a retry rather than any destructive "reset". The error itself
 * is logged server-side; the page deliberately shows no diagnostic detail.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Expense Tracker error:", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Something went wrong
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Your data is safe on the server. Try again, and if it keeps happening
        please sign in once more.
      </p>

      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button onClick={reset} className="sm:min-w-32">
          Try again
        </Button>
        <a
          href="/login"
          className="inline-flex h-11 items-center justify-center rounded-xl border border-border-subtle bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-w-32"
        >
          Go to login
        </a>
      </div>
    </main>
  );
}
