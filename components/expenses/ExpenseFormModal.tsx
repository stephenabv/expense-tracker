"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Expense } from "@/types/expense";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { DateField } from "@/components/ui/DateField";
import { SelectField } from "@/components/ui/SelectField";
import {
  CURRENCY_SYMBOL,
  formatAmount,
  formatCurrency,
  parseAmount,
} from "@/lib/currency";
import { formatDateKey, formatDateRange, todayKey } from "@/lib/dates";
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
  /** Opens the budget form when no allotment covers the chosen date. */
  onCreateBudget?: (date: string) => void;
}

/**
 * Shared add/edit expense form.
 *
 * The expense date drives everything: it decides which allotment applies, and
 * the amount is measured against *that* budget's balance. When no budget covers
 * the date the form says so and offers to create one, rather than quietly
 * charging an unrelated allotment.
 */
export function ExpenseFormModal({
  open,
  onClose,
  expense = null,
  onCreateBudget,
}: ExpenseFormModalProps) {
  const { addExpense, updateExpense, availableBalanceFor, budgetsCovering } =
    useTracker();
  const { showToast } = useToast();

  const isEditing = expense !== null;
  const today = todayKey();

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [budgetId, setBudgetId] = useState("");
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const date = expense?.expenseDate ?? today;
    setName(expense?.name ?? "");
    setAmount(expense ? formatAmount(expense.amount) : "");
    setExpenseDate(date);
    setBudgetId(expense?.budgetId ?? "");
    setErrors({});
  }, [open, expense, today]);

  // Budgets whose period covers the chosen date. Overlaps are prevented, so
  // this is normally exactly one — but the form still handles several rather
  // than assuming.
  const applicable = useMemo(() => {
    if (!open) return [];
    return budgetsCovering(expenseDate);
  }, [open, expenseDate, budgetsCovering]);

  // Auto-select when there is only one valid choice; never guess between two.
  useEffect(() => {
    if (!open) return;
    if (applicable.length === 1) {
      setBudgetId(applicable[0].id);
    } else if (!applicable.some((budget) => budget.id === budgetId)) {
      setBudgetId("");
    }
  }, [open, applicable, budgetId]);

  const selectedBudget = applicable.find((budget) => budget.id === budgetId) ?? null;

  const availableBalance = useMemo(() => {
    if (!open || !selectedBudget) return 0;
    return availableBalanceFor(selectedBudget.id, expense?.id);
  }, [open, selectedBudget, availableBalanceFor, expense?.id]);

  const parsedAmount = parseAmount(amount);
  const exceedsBalance =
    selectedBudget !== null &&
    parsedAmount !== null &&
    parsedAmount > 0 &&
    parsedAmount > availableBalance;

  const noBudget = applicable.length === 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const result = validateExpenseForm(name, amount, expenseDate, budgetId, {
      applicableBudgets: applicable,
      availableBalance: selectedBudget ? availableBalance : undefined,
    });

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Expense" : "Add Expense"}
      description={
        selectedBudget
          ? `${selectedBudget.name} · ${formatCurrency(Math.max(availableBalance, 0))} available`
          : "Choose a date covered by one of your budget allotments."
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
            disabled={exceedsBalance || noBudget}
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
          placeholder="Groceries"
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
          className="font-semibold tabular"
          error={errors.amount}
          onChange={(event) => {
            setAmount(event.target.value);
            if (errors.amount) setErrors((prev) => ({ ...prev, amount: undefined }));
          }}
        />

        <DateField
          label="Date"
          value={expenseDate}
          invalid={errors.expenseDate !== undefined}
          onChange={(event) => {
            setExpenseDate(event.target.value);
            setErrors((prev) => ({
              ...prev,
              expenseDate: undefined,
              budgetId: undefined,
              amount: undefined,
            }));
          }}
        />

        {noBudget ? (
          <div
            role="alert"
            className="rounded-xl border border-warning/30 bg-warning-soft p-3.5"
          >
            <p className="text-sm font-medium text-warning">
              No budget is assigned to this date.
            </p>
            <p className="mt-1 text-[0.8125rem] text-muted-strong">
              There is currently no budget allotment covering{" "}
              {formatDateKey(expenseDate)}.
            </p>
            {onCreateBudget ? (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => onCreateBudget(expenseDate)}
              >
                Create Budget
              </Button>
            ) : null}
          </div>
        ) : (
          <SelectField
            label="Budget"
            value={budgetId}
            error={errors.budgetId}
            hint={
              selectedBudget
                ? `Applies ${formatDateRange(selectedBudget.startDate, selectedBudget.endDate)}`
                : "Two budgets cover this date — pick the one this belongs to."
            }
            onChange={(event) => {
              setBudgetId(event.target.value);
              setErrors((prev) => ({ ...prev, budgetId: undefined, amount: undefined }));
            }}
          >
            {applicable.length > 1 ? (
              <option value="">Select a budget…</option>
            ) : null}
            {applicable.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </SelectField>
        )}

        {exceedsBalance && selectedBudget ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger-soft p-3.5"
          >
            <p className="text-sm font-medium text-danger">
              This is more than {selectedBudget.name} has left.
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
              Lower the amount, or raise this budget&apos;s allotment first.
            </p>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
