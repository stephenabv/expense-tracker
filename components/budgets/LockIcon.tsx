"use client";

/**
 * The padlock every budget surface uses to mark a locked record.
 *
 * Shared rather than redrawn per card: an open and a closed padlock that differ
 * slightly between two places reads as two different states.
 */
export function LockIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <rect x="4.5" y="8.5" width="11" height="7.5" rx="2" />
      {open ? (
        <path d="M7.5 8.5V6.5a2.5 2.5 0 0 1 4.9-.7" />
      ) : (
        <path d="M7.5 8.5V6.5a2.5 2.5 0 0 1 5 0v2" />
      )}
    </svg>
  );
}
