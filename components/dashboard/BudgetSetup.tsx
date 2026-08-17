"use client";

import { useState } from "react";

import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { CURRENCY_SYMBOL } from "@/lib/currency";
import { validateBudget } from "@/lib/validation";

/**
 * First-run screen.
 *
 * Until a budget exists there is no balance to report, so the app asks for one
 * thing and nothing else.
 */
export function BudgetSetup() {
  const { setBudget, expenses } = useTracker();
  const { showToast } = useToast();

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const result = validateBudget(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setBudget(result.value!);
    showToast("Budget set and locked", "positive");
  };

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center">
      <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-card sm:p-8">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-muted text-lg font-semibold text-foreground ring-1 ring-inset ring-border-subtle"
        >
          {CURRENCY_SYMBOL}
        </span>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          Set your budget allotment
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          This is the amount you have to work with. Your balance is always your
          budget minus everything you record.
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          <TextField
            label="Budget Allotment"
            placeholder="13,000.00"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            prefix={CURRENCY_SYMBOL}
            className="text-lg font-semibold tabular"
            value={draft}
            error={error}
            hint="You can change this later — it stays locked until you unlock it."
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(undefined);
            }}
          />

          <Button type="submit" className="w-full">
            Start tracking
          </Button>
        </form>

        {expenses.length > 0 ? (
          <p className="mt-4 text-[0.8125rem] text-muted">
            {expenses.length === 1
              ? "1 saved expense will be restored once you set a budget."
              : `${expenses.length} saved expenses will be restored once you set a budget.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
