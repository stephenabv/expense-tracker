/**
 * Pagination arithmetic.
 *
 * Pure and framework-free: the server uses it to bound a query, the client uses
 * it to draw the control, and because both read the same functions the label
 * under the list can never disagree with the rows above it.
 */

/** Page sizes offered in the UI. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

/** Twenty rows fills a phone screen without a long scroll. */
export const DEFAULT_PAGE_SIZE: PageSize = 20;

/**
 * Hard ceiling on rows per request.
 *
 * The page size arrives from the client, so it is clamped rather than trusted:
 * without this, `?pageSize=1000000` would be a request to read the whole table.
 */
export const MAX_PAGE_SIZE = 100;

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** 1-based index of the first row on this page; 0 when there are none. */
  firstItem: number;
  /** 1-based index of the last row on this page; 0 when there are none. */
  lastItem: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** A page of rows plus the numbers describing where it sits. */
export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

/** Coerces anything into a usable page size. */
export function clampPageSize(value: unknown): number {
  const size = Math.trunc(Number(value));
  if (!Number.isFinite(size) || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAX_PAGE_SIZE);
}

/** Coerces anything into a page number of at least 1. */
export function clampPage(value: unknown): number {
  const page = Math.trunc(Number(value));
  if (!Number.isFinite(page) || page < 1) return 1;
  return page;
}

/**
 * Describes a page of a known-size result set.
 *
 * A page beyond the end is pulled back to the last real page rather than
 * returning nothing: a filter that shrinks the data must not strand the reader
 * on an empty page 7.
 */
export function paginationFor(
  totalItems: number,
  page: number,
  pageSize: number,
): Pagination {
  const size = clampPageSize(pageSize);
  const total = Math.max(0, Math.trunc(totalItems) || 0);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(clampPage(page), totalPages);

  const firstItem = total === 0 ? 0 : (current - 1) * size + 1;
  const lastItem = total === 0 ? 0 : Math.min(current * size, total);

  return {
    page: current,
    pageSize: size,
    totalItems: total,
    totalPages,
    firstItem,
    lastItem,
    hasPrevious: current > 1,
    hasNext: current < totalPages,
  };
}

/** Rows to skip for a page, for the SQL `OFFSET`. */
export function offsetFor(page: number, pageSize: number): number {
  return (clampPage(page) - 1) * clampPageSize(pageSize);
}

/** `Showing 21–40 of 245`, or a plain count when everything fits. */
export function describeRange(
  pagination: Pagination,
  noun = "expenses",
): string {
  if (pagination.totalItems === 0) return `No ${noun}`;
  if (pagination.totalPages === 1) {
    return pagination.totalItems === 1
      ? `1 ${noun.replace(/s$/, "")}`
      : `${pagination.totalItems} ${noun}`;
  }
  return `Showing ${pagination.firstItem}–${pagination.lastItem} of ${pagination.totalItems}`;
}

/** A gap in the page list, rendered as an ellipsis. */
export const PAGE_GAP = "gap" as const;

export type PageToken = number | typeof PAGE_GAP;

/**
 * The page numbers to display, with gaps collapsed.
 *
 * Always shows the first and last page plus a window around the current one, so
 * the control stays a fixed width whether there are 3 pages or 300:
 *
 *   1 … 5 6 7 … 20
 */
export function pageWindow(
  page: number,
  totalPages: number,
  /** How many neighbours to show on each side of the current page. */
  siblings = 1,
): PageToken[] {
  if (totalPages <= 1) return [1];

  const current = Math.min(Math.max(clampPage(page), 1), totalPages);
  const first = 1;
  const last = totalPages;

  const start = Math.max(first, current - siblings);
  const end = Math.min(last, current + siblings);

  const tokens: PageToken[] = [];

  for (let index = start; index <= end; index += 1) tokens.push(index);

  if (start > first) {
    // A single hidden page is shown rather than replaced by an ellipsis that
    // would take the same room and say less.
    if (start === first + 2) tokens.unshift(first + 1);
    else if (start > first + 1) tokens.unshift(PAGE_GAP);
    tokens.unshift(first);
  }

  if (end < last) {
    if (end === last - 2) tokens.push(last - 1);
    else if (end < last - 1) tokens.push(PAGE_GAP);
    tokens.push(last);
  }

  return tokens;
}
