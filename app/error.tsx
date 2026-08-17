"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { STORAGE_KEY } from "@/lib/storage";

/**
 * Last line of defence.
 *
 * The storage layer already repairs malformed data, so reaching this screen
 * means something unexpected happened — offer a recovery path rather than a
 * blank page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Expense Tracker crashed:", error);
  }, [error]);

  const clearAndReload = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable; reloading is still worth a try.
    }
    window.location.reload();
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Something went wrong
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Your saved data is still on this device. Try again, or reset the app if
        the problem keeps happening.
      </p>

      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button onClick={reset} className="sm:min-w-32">
          Try again
        </Button>
        <Button variant="secondary" onClick={clearAndReload} className="sm:min-w-32">
          Reset saved data
        </Button>
      </div>
    </main>
  );
}
