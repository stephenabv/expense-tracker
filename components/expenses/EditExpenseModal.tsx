"use client";

import type { Expense } from "@/types/expense";
import { ExpenseFormModal } from "@/components/expenses/ExpenseFormModal";

export interface EditExpenseModalProps {
  open: boolean;
  onClose: () => void;
  expense: Expense | null;
}

/** Edit flow, sharing all validation with the create flow. */
export function EditExpenseModal({ open, onClose, expense }: EditExpenseModalProps) {
  return <ExpenseFormModal open={open} onClose={onClose} expense={expense} />;
}
