"use client";

import {
  PAGE_GAP,
  PAGE_SIZES,
  describeRange,
  pageWindow,
  type Pagination as PaginationState,
} from "@/lib/pagination";
import { cn } from "@/lib/utils";

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d={direction === "left" ? "m12 5-4 5 4 5" : "m8 5 4 5-4 5"} />
    </svg>
  );
}

const control =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium " +
  "transition-[background-color,color,transform] duration-150 active:scale-[0.97] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-40";

export interface PaginationProps {
  pagination: PaginationState;
  onPageChange: (page: number) => void;
  /** Omit to hide the rows-per-page control. */
  onPageSizeChange?: (pageSize: number) => void;
  /** Dims the control and blocks input while a page is being fetched. */
  busy?: boolean;
  /** Plural noun for the range label, e.g. "expenses". */
  noun?: string;
  className?: string;
}

/**
 * Pagination for a server-paged list.
 *
 * Two layouts, one component. Phones get Previous / “2 of 13” / Next, because a
 * row of numbered buttons either overflows or shrinks below a comfortable tap
 * target. From `sm` up the numbers appear, windowed around the current page so
 * the control is the same width at 3 pages as at 300.
 *
 * The whole control is hidden when there is nothing to page through: one page
 * of results needs no navigation, only the count.
 */
export function Pagination({
  pagination,
  onPageChange,
  onPageSizeChange,
  busy = false,
  noun = "expenses",
  className,
}: PaginationProps) {
  const { page, totalPages, hasPrevious, hasNext } = pagination;
  const tokens = pageWindow(page, totalPages);
  const multiPage = totalPages > 1;

  const go = (next: number) => {
    if (busy || next === page || next < 1 || next > totalPages) return;
    onPageChange(next);
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3",
        busy && "opacity-60",
        className,
      )}
    >
      <p aria-live="polite" className="text-[0.8125rem] text-muted">
        {describeRange(pagination, noun)}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted">
            <span className="whitespace-nowrap">Rows per page</span>
            <select
              aria-label="Rows per page"
              value={pagination.pageSize}
              disabled={busy}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-9 rounded-lg border border-border-subtle bg-surface px-2 text-sm text-foreground transition-colors duration-150 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {multiPage ? (
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => go(page - 1)}
              disabled={!hasPrevious || busy}
              aria-label="Previous page"
              className={cn(control, "text-muted-strong hover:bg-surface-muted hover:text-foreground")}
            >
              <ChevronIcon direction="left" />
              <span className="ml-1 sm:hidden">Previous</span>
            </button>

            {/* Numbers on anything wider than a phone. */}
            <span className="hidden items-center gap-1 sm:flex">
              {tokens.map((token, index) =>
                token === PAGE_GAP ? (
                  <span
                    key={`gap-${index}`}
                    aria-hidden="true"
                    className="px-1 text-sm text-muted"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={token}
                    type="button"
                    onClick={() => go(token)}
                    disabled={busy}
                    aria-label={`Page ${token}`}
                    aria-current={token === page ? "page" : undefined}
                    className={cn(
                      control,
                      token === page
                        ? "bg-foreground text-background"
                        : "text-muted-strong hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    {token}
                  </button>
                ),
              )}
            </span>

            {/* A phone gets the position instead of the numbers. */}
            <span className="px-2 text-[0.8125rem] tabular text-muted-strong sm:hidden">
              {page} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => go(page + 1)}
              disabled={!hasNext || busy}
              aria-label="Next page"
              className={cn(control, "text-muted-strong hover:bg-surface-muted hover:text-foreground")}
            >
              <span className="mr-1 sm:hidden">Next</span>
              <ChevronIcon direction="right" />
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
