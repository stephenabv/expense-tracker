/**
 * Calendar-date utilities.
 *
 * Dates are handled as `YYYY-MM-DD` keys in the user's local time zone, never as
 * timestamps. Budget periods and expense dates are calendar concepts: an expense
 * recorded at 11pm on the 5th belongs to the 5th, whatever UTC thinks.
 *
 * Keys are zero-padded, so lexicographic comparison is chronological comparison.
 */

/** A local calendar date as `YYYY-MM-DD`. */
export type DateKey = string;

/** Formats a date as a local `YYYY-MM-DD` key. */
export function toDateKey(value: Date | string): DateKey {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses a `YYYY-MM-DD` key into a local Date at midnight. */
export function fromDateKey(key: DateKey): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isValidDateKey(key: unknown): key is DateKey {
  return typeof key === "string" && fromDateKey(key) !== null;
}

/** Today's key. */
export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

/** Shifts a key by whole days. */
export function shiftDateKey(key: DateKey, days: number): DateKey {
  const date = fromDateKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** Whole days from `start` to `end`, inclusive of both ends. */
export function daysBetween(start: DateKey, end: DateKey): number {
  const from = fromDateKey(start);
  const to = fromDateKey(end);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/** Every key from `start` to `end`, inclusive. Capped to keep loops bounded. */
export function enumerateDates(
  start: DateKey,
  end: DateKey,
  limit = 3_660,
): DateKey[] {
  if (!isValidDateKey(start) || !isValidDateKey(end) || start > end) return [];

  const keys: DateKey[] = [];
  let cursor = start;
  while (cursor <= end && keys.length < limit) {
    keys.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return keys;
}

const longDate = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const monthDay = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
});

const shortMonthDay = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
});

/** `August 17, 2026`. */
export function formatDateKey(key: DateKey): string {
  const date = fromDateKey(key);
  return date ? longDate.format(date) : key;
}

/** `Aug 17` — for tight spaces such as budget cards. */
export function formatShortDateKey(key: DateKey): string {
  const date = fromDateKey(key);
  return date ? shortMonthDay.format(date) : key;
}

/**
 * `August 1 – August 17, 2026`, collapsing a same-day range to a single date and
 * dropping the repeated year when both ends share it.
 */
export function formatDateRange(start: DateKey, end: DateKey): string {
  if (start === end) return formatDateKey(start);

  const from = fromDateKey(start);
  const to = fromDateKey(end);
  if (!from || !to) return `${start} – ${end}`;

  if (from.getFullYear() === to.getFullYear()) {
    return `${monthDay.format(from)} – ${longDate.format(to)}`;
  }
  return `${longDate.format(from)} – ${longDate.format(to)}`;
}

/** `Aug 1 – Aug 5` — the compact form used on budget cards. */
export function formatShortDateRange(start: DateKey, end: DateKey): string {
  if (start === end) return formatShortDateKey(start);
  return `${formatShortDateKey(start)} – ${formatShortDateKey(end)}`;
}

/** True when `date` falls within the inclusive range. */
export function isWithinRange(
  date: DateKey,
  start: DateKey,
  end: DateKey,
): boolean {
  return date >= start && date <= end;
}

/** True when two inclusive ranges share at least one day. */
export function rangesOverlap(
  aStart: DateKey,
  aEnd: DateKey,
  bStart: DateKey,
  bEnd: DateKey,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** The shared span of two overlapping ranges, or `null` when they are disjoint. */
export function overlapRange(
  aStart: DateKey,
  aEnd: DateKey,
  bStart: DateKey,
  bEnd: DateKey,
): { start: DateKey; end: DateKey } | null {
  if (!rangesOverlap(aStart, aEnd, bStart, bEnd)) return null;
  return {
    start: aStart > bStart ? aStart : bStart,
    end: aEnd < bEnd ? aEnd : bEnd,
  };
}
