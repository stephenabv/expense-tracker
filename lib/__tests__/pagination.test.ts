import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PAGE_GAP,
  clampPage,
  clampPageSize,
  describeRange,
  offsetFor,
  pageWindow,
  paginationFor,
} from "@/lib/pagination";

describe("clampPageSize", () => {
  it("accepts a sensible size", () => {
    expect(clampPageSize(50)).toBe(50);
  });

  it("falls back for nonsense", () => {
    for (const value of ["abc", 0, -5, null, undefined, NaN]) {
      expect(clampPageSize(value)).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it("caps a huge request rather than reading the table", () => {
    expect(clampPageSize(1_000_000)).toBe(MAX_PAGE_SIZE);
  });
});

describe("clampPage", () => {
  it("never goes below one", () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-3)).toBe(1);
    expect(clampPage("nope")).toBe(1);
  });
});

describe("paginationFor", () => {
  it("describes a middle page", () => {
    const p = paginationFor(245, 2, 20);
    expect(p).toMatchObject({
      page: 2,
      pageSize: 20,
      totalItems: 245,
      totalPages: 13,
      firstItem: 21,
      lastItem: 40,
      hasPrevious: true,
      hasNext: true,
    });
  });

  it("handles the last, partial page", () => {
    const p = paginationFor(245, 13, 20);
    expect(p.firstItem).toBe(241);
    expect(p.lastItem).toBe(245);
    expect(p.hasNext).toBe(false);
  });

  it("pulls an out-of-range page back to the last real one", () => {
    // A filter that shrinks the data must not strand the reader on page 7.
    expect(paginationFor(12, 7, 20).page).toBe(1);
    expect(paginationFor(45, 99, 20).page).toBe(3);
  });

  it("stays coherent with no rows at all", () => {
    const p = paginationFor(0, 3, 20);
    expect(p).toMatchObject({
      page: 1,
      totalPages: 1,
      firstItem: 0,
      lastItem: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });
});

describe("offsetFor", () => {
  it("skips the pages before it", () => {
    expect(offsetFor(1, 20)).toBe(0);
    expect(offsetFor(3, 20)).toBe(40);
  });
});

describe("describeRange", () => {
  it("names the window when there is more than one page", () => {
    expect(describeRange(paginationFor(245, 2, 20))).toBe("Showing 21–40 of 245");
  });

  it("just counts when everything fits", () => {
    expect(describeRange(paginationFor(7, 1, 20))).toBe("7 expenses");
    expect(describeRange(paginationFor(1, 1, 20))).toBe("1 expense");
  });

  it("says so when there is nothing", () => {
    expect(describeRange(paginationFor(0, 1, 20))).toBe("No expenses");
  });
});

describe("pageWindow", () => {
  it("lists every page when there are few", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it("keeps first, last and a window around the current page", () => {
    expect(pageWindow(6, 20)).toEqual([1, PAGE_GAP, 5, 6, 7, PAGE_GAP, 20]);
  });

  it("does not open a gap at the start when near it", () => {
    expect(pageWindow(2, 20)).toEqual([1, 2, 3, PAGE_GAP, 20]);
  });

  it("does not open a gap at the end when near it", () => {
    expect(pageWindow(19, 20)).toEqual([1, PAGE_GAP, 18, 19, 20]);
  });

  it("shows a lone hidden page rather than an ellipsis for it", () => {
    // An ellipsis standing in for a single page costs the same room and says
    // less than the page number itself.
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, PAGE_GAP, 20]);
  });

  it("never grows without bound", () => {
    expect(pageWindow(500, 1_000).length).toBeLessThanOrEqual(7);
  });

  it("copes with a single page", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 0)).toEqual([1]);
  });
});
