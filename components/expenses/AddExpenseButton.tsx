"use client";

export interface AddExpenseButtonProps {
  onClick: () => void;
}

/**
 * Floating action button, bottom-centre.
 *
 * Sits above the safe-area inset so it stays reachable on phones with a home
 * indicator, and the page reserves matching bottom padding so it never covers
 * the last expense row.
 */
export function AddExpenseButton({ onClick }: AddExpenseButtonProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={onClick}
        aria-label="Add expense"
        className="pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-foreground pl-5 pr-6 text-background shadow-float transition-transform duration-150 hover:scale-[1.03] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          className="h-5 w-5"
        >
          <path d="M10 4.5v11M4.5 10h11" />
        </svg>
        <span className="text-[0.9375rem] font-semibold">Add Expense</span>
      </button>
    </div>
  );
}
