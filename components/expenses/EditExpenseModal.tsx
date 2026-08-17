"use client";

import type { Expense } from "@/types/expense";
import { ExpenseFormModal } from "@/components/expenses/ExpenseFormModal";

export interface EditExpenseModalProps {
  open: boolean;
  onClose: () => void;
  expense: Expense | null;
  onCreateBudget?: (date: string) => void;
}

/** Edit flow, sharing all validation with the create flow. */
export function EditExpenseModal({
  open,
  onClose,
  expense,
  onCreateBudget,
}: EditExpenseModalProps) {
  return (
    <ExpenseFormModal
      open={open}
      onClose={onClose}
      expense={expense}
      onCreateBudget={onCreateBudget}
    />
  );
}
