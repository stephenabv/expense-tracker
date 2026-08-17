"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Expense } from "@/types/expense";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import {
  CURRENCY_SYMBOL,
  formatAmount,
  formatCurrency,
  parseAmount,
} from "@/lib/currency";
import {
  MAX_NAME_LENGTH,
  validateExpenseForm,
  type ExpenseFormErrors,
} from "@/lib/validation";

const FORM_ID = "expense-form";

export interface ExpenseFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Provide an expense to edit it; omit to create a new one. */
  expense?: Expense | null;
}

/**
 * Shared add/edit form.
 *
 * Both flows run the exact same validation — including the overdraft check —
 * so an edit can no more push the balance negative than a new expense can.
 */
export function ExpenseFormModal({
  open,
  onClose,
  expense = null,
}: ExpenseFormModalProps) {
  const { addExpense, updateExpense, availableBalanceFor, budget } = useTracker();
  const { showToast } = useToast();

  const isEditing = expense !== null;

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);

  // Balance this expense draws from. When editing, the row's own amount is
  // excluded so the user is not charged for it twice.
  const availableBalance = useMemo(() => {
    if (!open) return 0;
    return availableBalanceFor(expense?.id);
    // `open` and the expense identify the moment the dialog was launched.
  }, [open, expense?.id, availableBalanceFor]);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(expense?.name ?? "");
    setAmount(expense ? formatAmount(expense.amount) : "");
    setErrors({});
  }, [open, expense]);

  const parsedAmount = parseAmount(amount);
  const exceedsBalance =
    parsedAmount !== null &&
    parsedAmount > 0 &&
    parsedAmount > availableBalance;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const result = validateExpenseForm(name, amount, { availableBalance });

    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors.name) nameRef.current?.focus();
      return;
    }

    const values = result.values!;

    if (isEditing && expense) {
      updateExpense(expense.id, values);
      showToast("Expense updated", "positive");
    } else {
      addExpense(values);
      showToast(`${values.name} · ${formatCurrency(values.amount)} added`, "positive");
    }

    onClose();
  };

  const budgetConfigured = budget !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Expense" : "Add Expense"}
      description={
        budgetConfigured
          ? `Available balance ${formatCurrency(Math.max(availableBalance, 0))}`
          : "Set a budget allotment to track this against your balance."
      }
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            className="flex-1"
            disabled={exceedsBalance}
          >
            {isEditing ? "Save changes" : "Add Expense"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
        <TextField
          ref={nameRef}
          label="Expense Name"
          placeholder="Food"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          enterKeyHint="next"
          error={errors.name}
          onChange={(event) => {
            setName(event.target.value);
            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
          }}
        />

        <TextField
          label="Amount"
          placeholder="500.00"
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          prefix={CURRENCY_SYMBOL}
          error={errors.amount}
          className="font-semibold tabular"
          onChange={(event) => {
            setAmount(event.target.value);
            if (errors.amount)
              setErrors((prev) => ({ ...prev, amount: undefined }));
          }}
        />

        {exceedsBalance ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger-soft p-3.5"
          >
            <p className="text-sm font-medium text-danger">
              This is more than you have left.
            </p>
            <dl className="mt-2 space-y-1 text-[0.8125rem]">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-strong">Available balance</dt>
                <dd className="font-medium tabular text-foreground">
                  {formatCurrency(Math.max(availableBalance, 0))}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-strong">This expense</dt>
                <dd className="font-medium tabular text-foreground">
                  {formatCurrency(parsedAmount ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.8125rem] text-muted-strong">
              Lower the amount, or raise your budget allotment first.
            </p>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
