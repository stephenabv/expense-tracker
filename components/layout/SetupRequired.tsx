import { CURRENCY_SYMBOL } from "@/lib/currency";

/**
 * Shown when the server has no database configured.
 *
 * Better than a stack trace: the app says exactly what is missing and how to
 * supply it, without leaking any connection details.
 */
export function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-card sm:p-8">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-base font-semibold text-background"
        >
          {CURRENCY_SYMBOL}
        </span>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
          Setup required
        </h1>
        <p className="mt-2 text-sm text-muted">
          Expense Tracker needs a PostgreSQL database and an authentication
          secret before accounts can be used.
        </p>

        <ol className="mt-5 space-y-2 text-sm text-muted-strong">
          <li>
            1. Copy <code className="text-foreground">.env.example</code> to{" "}
            <code className="text-foreground">.env.local</code>.
          </li>
          <li>
            2. Set <code className="text-foreground">DATABASE_URL</code> and{" "}
            <code className="text-foreground">AUTH_SECRET</code>.
          </li>
          <li>
            3. Run <code className="text-foreground">npm run db:migrate</code>.
          </li>
        </ol>

        <p className="mt-5 text-[0.8125rem] text-muted">
          The README has the full list, including the optional email provider.
        </p>
      </div>
    </main>
  );
}
