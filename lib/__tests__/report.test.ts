import { describe, expect, it } from "vitest";

import {
  budgetPeriodLabel,
  budgetStatusLabel,
  columnWidths,
  buildHistoryReport,
  groupDaysByDate,
  historyReportFilename,
  reportSummaryRows,
} from "@/lib/pdf/report";
import { buildHistory, filterHistory, summarizeHistory } from "@/lib/history";
import { budget, completedBudget, expense, generalBudget } from "./helpers";

const generatedAt = new Date(2026, 7, 18, 9, 30);

const week1 = budget("b1", "August Week 1", 5_000, "2026-08-01", "2026-08-05");
const daily = budget("b2", "Daily Expenses", 1_000, "2026-08-06");

const expenses = [
  expense("e1", "b1", "Food", 500, "2026-08-05"),
  expense("e2", "b1", "Transportation", 300, "2026-08-05"),
  expense("e3", "b2", "Coffee", 100, "2026-08-06"),
  expense("e4", "b2", "Food", 300, "2026-08-06"),
];

const days = buildHistory([week1, daily], expenses).reverse();

function toBytes(doc: ReturnType<typeof buildHistoryReport>): Uint8Array {
  return new Uint8Array(doc.output("arraybuffer"));
}

function header(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.slice(0, 5));
}

describe("buildHistoryReport", () => {
  it("produces a real PDF document", () => {
    const doc = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 5 – August 6, 2026",
      generatedAt,
    });

    const bytes = toBytes(doc);
    expect(header(bytes)).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });

  it("fits a small multi-budget report on one page", () => {
    const doc = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 5 – August 6, 2026",
      generatedAt,
    });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("embeds a font that can actually draw the peso sign", () => {
    const doc = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 5 – August 6, 2026",
      generatedAt,
    });

    expect(doc.getFontList()).toHaveProperty("DejaVuSans");

    // jsPDF's built-in faces are WinAnsi-encoded and have no peso sign, so
    // every amount would print blank without an embedded font.
    for (const style of ["normal", "bold"] as const) {
      doc.setFont("DejaVuSans", style);
      const [peso] = doc.getCharWidthsArray("₱");
      const [digit] = doc.getCharWidthsArray("8");
      expect(peso).toBeGreaterThan(0);
      expect(peso).toBeCloseTo(digit, 5);
    }
  });

  it("keeps each budget's figures separate in the summary", () => {
    const summary = summarizeHistory(days);

    expect(summary.budgets).toHaveLength(2);
    const week = summary.budgets.find((b) => b.budgetId === "b1")!;
    const day = summary.budgets.find((b) => b.budgetId === "b2")!;

    expect(week.budgetAmount).toBe(5_000);
    expect(week.totalExpenses).toBe(800);
    expect(week.remaining).toBe(4_200);

    expect(day.budgetAmount).toBe(1_000);
    expect(day.totalExpenses).toBe(400);
    expect(day.remaining).toBe(600);
  });

  it("paginates a large dataset instead of overflowing one page", () => {
    const many = Array.from({ length: 30 }, (_, index) => {
      const day = String((index % 28) + 1).padStart(2, "0");
      return budget(`m${index}`, `Budget ${index + 1}`, 5_000, `2026-06-${day}`);
    });
    const manyExpenses = many.flatMap((b, i) =>
      Array.from({ length: 8 }, (_, j) =>
        expense(`${i}-${j}`, b.id, `Expense ${j + 1}`, 100 + j, b.startDate!),
      ),
    );

    const built = buildHistory(many, manyExpenses).reverse();
    const doc = buildHistoryReport({
      days: built,
      summary: summarizeHistory(built),
      periodLabel: "June 2026",
      generatedAt,
    });

    expect(doc.getNumberOfPages()).toBeGreaterThan(4);
    expect(header(toBytes(doc))).toBe("%PDF-");
  });

  it("handles a day with many expenses spilling across pages", () => {
    const heavy = buildHistory(
      [budget("h", "Heavy", 100_000, "2026-08-17")],
      Array.from({ length: 120 }, (_, i) =>
        expense(`e${i}`, "h", `Expense number ${i + 1}`, 25.5, "2026-08-17"),
      ),
    );

    const doc = buildHistoryReport({
      days: heavy,
      summary: summarizeHistory(heavy),
      periodLabel: "August 17, 2026",
      generatedAt,
    });

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it("renders an explicit empty state rather than a blank report", () => {
    const doc = buildHistoryReport({
      days: [],
      summary: summarizeHistory([]),
      periodLabel: "August 20, 2026",
      generatedAt,
    });

    expect(doc.getNumberOfPages()).toBe(1);
    expect(header(toBytes(doc))).toBe("%PDF-");
  });

  it("does not fall over on long names or accented characters", () => {
    const built = buildHistory(
      [budget("l", "A rather long budget name here", 50_000, "2026-08-17")],
      [
        expense("1", "l", "A".repeat(60), 500, "2026-08-17"),
        expense("2", "l", "Piña colada", 250, "2026-08-17"),
      ],
    );

    const doc = buildHistoryReport({
      days: built,
      summary: summarizeHistory(built),
      periodLabel: "August 17, 2026",
      generatedAt,
    });

    doc.setFont("DejaVuSans", "normal");
    expect(doc.getCharWidthsArray("ñ")[0]).toBeGreaterThan(0);
    expect(header(toBytes(doc))).toBe("%PDF-");
  });

  it("exports only the days it is given", () => {
    const filtered = days.filter((day) => day.budgetId === "b2");

    const small = buildHistoryReport({
      days: filtered,
      summary: summarizeHistory(filtered),
      periodLabel: "August 6, 2026",
      generatedAt,
    });
    const full = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 5 – August 6, 2026",
      generatedAt,
    });

    expect(toBytes(small).byteLength).toBeLessThan(toBytes(full).byteLength);
  });

  it("summarises only the filtered selection", () => {
    const filtered = days.filter((day) => day.budgetId === "b2");
    const summary = summarizeHistory(filtered);

    expect(summary.budgetCount).toBe(1);
    expect(summary.totalExpenses).toBe(400);
    expect(summary.totalAllocated).toBe(1_000);
  });
});

describe("historyReportFilename", () => {
  it("names a single-day export by its date", () => {
    const single = buildHistory([daily], [expense("e", "b2", "Food", 100, "2026-08-06")]);
    expect(historyReportFilename(summarizeHistory(single))).toBe(
      "expense-tracker-history-2026-08-06.pdf",
    );
  });

  it("names a range export by both ends", () => {
    expect(historyReportFilename(summarizeHistory(days))).toBe(
      "expense-tracker-history-2026-08-05_to_2026-08-06.pdf",
    );
  });

  it("falls back to the generation date when nothing matched", () => {
    expect(historyReportFilename(summarizeHistory([]), generatedAt)).toBe(
      "expense-tracker-history-20260818.pdf",
    );
  });
});

/* ------------------------------------------- multiple and general budgets -- */

const emergency = generalBudget("b4", "Emergency Fund", 10_000);

const mixedBudgets = [week1, daily, emergency];
const mixedExpenses = [
  ...expenses,
  expense("g1", "b4", "Medicine", 1_000, "2026-08-19"),
  expense("g2", "b4", "Food", 300, "2026-08-19"),
  // Same day as a dated budget, so one date has two allotments.
  expense("g3", "b4", "Emergency taxi", 250, "2026-08-06"),
];

const mixedDays = buildHistory(mixedBudgets, mixedExpenses).reverse();

describe("budgetPeriodLabel", () => {
  it("names a general allotment rather than printing a blank period", () => {
    expect(
      budgetPeriodLabel({ budgetStartDate: null, budgetEndDate: null }),
    ).toBe("No Specific Date");
  });

  it("prints a single date once", () => {
    expect(
      budgetPeriodLabel({
        budgetStartDate: "2026-08-06",
        budgetEndDate: "2026-08-06",
      }),
    ).toBe("August 6, 2026");
  });

  it("prints both ends of a range", () => {
    expect(
      budgetPeriodLabel({
        budgetStartDate: "2026-08-01",
        budgetEndDate: "2026-08-05",
      }),
    ).toBe("August 1, 2026 – August 5, 2026");
  });
});

describe("groupDaysByDate", () => {
  it("puts every allotment that spent on a date into one group", () => {
    const groups = groupDaysByDate(mixedDays);
    const aug6 = groups.find((group) => group.date === "2026-08-06")!;

    expect(aug6.entries.map((entry) => entry.budgetName).sort()).toEqual([
      "Daily Expenses",
      "Emergency Fund",
    ]);
  });

  it("totals the date across its allotments", () => {
    const aug6 = groupDaysByDate(mixedDays).find((g) => g.date === "2026-08-06")!;
    // 100 + 300 from the daily budget, 250 from the emergency fund.
    expect(aug6.total).toBe(650);
    expect(aug6.expenseCount).toBe(3);
  });

  it("keeps a single-budget date to one block", () => {
    const aug19 = groupDaysByDate(mixedDays).find((g) => g.date === "2026-08-19")!;
    expect(aug19.entries).toHaveLength(1);
    expect(aug19.total).toBe(1_300);
  });

  it("preserves the order the days arrive in", () => {
    expect(groupDaysByDate(mixedDays).map((g) => g.date)).toEqual([
      "2026-08-19",
      "2026-08-06",
      "2026-08-05",
    ]);
  });
});

describe("reportSummaryRows", () => {
  const summary = summarizeHistory(mixedDays);

  it("labels the combined figure as a total across budgets", () => {
    const labels = reportSummaryRows(summary).map(([label]) => label);
    expect(labels).toContain("Total Expenses Across Budgets");
  });

  it("never presents a combined remaining balance", () => {
    // Two allotments' leftovers are not one spendable figure.
    const labels = reportSummaryRows(summary).map(([label]) => label);
    expect(labels.some((label) => /remaining/i.test(label))).toBe(false);
  });

  it("adds spending across every selected budget", () => {
    const row = reportSummaryRows(summary).find(
      ([label]) => label === "Total Expenses Across Budgets",
    )!;
    // 800 (week 1) + 400 (daily) + 1,550 (emergency)
    expect(row[1]).toBe("₱2,750.00");
  });
});

describe("per-budget accounting in the report", () => {
  it("keeps a general allotment's balance separate from the dated ones", () => {
    const summary = summarizeHistory(mixedDays);
    const fund = summary.budgets.find((b) => b.budgetId === "b4")!;

    expect(fund.budgetAmount).toBe(10_000);
    expect(fund.totalExpenses).toBe(1_550);
    expect(fund.remaining).toBe(8_450);
    expect(budgetPeriodLabel(fund)).toBe("No Specific Date");
  });

  it("reports each allotment's own period, not its activity span", () => {
    const summary = summarizeHistory(mixedDays);
    const week = summary.budgets.find((b) => b.budgetId === "b1")!;

    // Spending happened only on Aug 5, but the budget runs Aug 1–5.
    expect(week.firstDate).toBe("2026-08-05");
    expect(budgetPeriodLabel(week)).toBe("August 1, 2026 – August 5, 2026");
  });
});

describe("budget summary column widths", () => {
  // A4 in points, less the two margins — the page the report actually uses.
  const A4 = 595.28 - 96;

  for (const [label, withMoved] of [
    ["without a transfer column", false],
    ["with a transfer column", true],
  ] as const) {
    it(`fits the page ${label}`, () => {
      const widths = Object.values(columnWidths(A4, withMoved)).map(
        (style) => style.cellWidth,
      );
      const total = widths.reduce((sum, width) => sum + width, 0);

      /*
       * Exactly, not approximately.
       *
       * Every column is fixed, so autoTable has nothing to stretch: any
       * remainder in either direction is reported as content it could not fit.
       */
      expect(total).toBeCloseTo(A4, 6);
    });

    it(`leaves every column usable ${label}`, () => {
      const widths = Object.values(columnWidths(A4, withMoved)).map(
        (style) => style.cellWidth,
      );

      /*
       * The bug this guards against: widths were once a fixed subtraction from
       * the content width, which was measured on Letter. On A4 the name column
       * came out at 43pt and "Emergency Fund" wrapped down a column one letter
       * wide. Nothing may fall below what a money figure needs.
       */
      for (const width of widths) expect(width).toBeGreaterThanOrEqual(50);
      // The name column is the widest; it has the longest text to hold.
      expect(widths[0]).toBe(Math.max(...widths));
    });
  }

  it("scales with the page rather than assuming one size", () => {
    const narrow = Object.values(columnWidths(400, true)).map((s) => s.cellWidth);
    const wide = Object.values(columnWidths(800, true)).map((s) => s.cellWidth);

    expect(narrow.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 6);
    expect(wide.reduce((a, b) => a + b, 0)).toBeCloseTo(800, 6);
    expect(wide[0]).toBeGreaterThan(narrow[0]);
  });
});

describe("fully spent budgets in the report", () => {
  const closed = completedBudget("c1", "August Food", 1_000, "2026-08-01", "2026-08-31");
  const open = budget("c2", "September Food", 2_000, "2026-09-01", "2026-09-30");
  const charged = [
    expense("x1", "c1", "Groceries", 1_000, "2026-08-03"),
    expense("x2", "c2", "Groceries", 500, "2026-09-03"),
  ];
  const both = buildHistory([closed, open], charged);

  it("keeps a closed allotment in the report rather than dropping it", () => {
    const summary = summarizeHistory(both);

    // Excluding it would understate both figures by the closed budget's share.
    expect(summary.budgetCount).toBe(2);
    expect(summary.totalAllocated).toBe(3_000);
    expect(summary.totalExpenses).toBe(1_500);
  });

  it("distinguishes an active allotment from a fully spent one", () => {
    const summary = summarizeHistory(both);
    const rows = summary.budgets.map((entry) => [
      entry.budgetName,
      budgetStatusLabel(entry),
    ]);

    expect(rows).toContainEqual(["August Food", "Fully Spent"]);
    expect(rows).toContainEqual(["September Food", "Active"]);
  });

  it("still renders a document containing both", () => {
    const doc = buildHistoryReport({
      days: [...both].reverse(),
      summary: summarizeHistory(both),
      periodLabel: "All recorded history",
      generatedAt,
    });
    expect(header(toBytes(doc))).toBe("%PDF-");
  });
});

describe("reports containing several budgets", () => {
  it("renders a mixed dated and general report", () => {
    const doc = buildHistoryReport({
      days: mixedDays,
      summary: summarizeHistory(mixedDays),
      periodLabel: "August 5 – August 19, 2026",
      generatedAt,
    });
    expect(header(toBytes(doc))).toBe("%PDF-");
    // Three allotments over three dates stays compact; the point is that it
    // paginates rather than overflowing a page.
    expect(doc.getNumberOfPages()).toBeLessThanOrEqual(2);
  });

  it("renders a report narrowed to one allotment", () => {
    const filtered = filterHistory(buildHistory(mixedBudgets, mixedExpenses), {
      mode: "all",
      budgetId: "b4",
    });

    const doc = buildHistoryReport({
      days: filtered,
      summary: summarizeHistory(filtered),
      periodLabel: "All recorded history",
      budgetLabel: "Emergency Fund (No Specific Date)",
      generatedAt,
    });

    expect(header(toBytes(doc))).toBe("%PDF-");
    // Only the chosen allotment's records reach the document.
    expect(filtered.every((day) => day.budgetId === "b4")).toBe(true);
    expect(summarizeHistory(filtered).budgetCount).toBe(1);
  });
});

describe("PDF data matches the active filter", () => {
  const all = buildHistory(mixedBudgets, mixedExpenses);

  it("exports exactly the days a single-date filter selected", () => {
    const filter = { mode: "single", date: "2026-08-19" } as const;
    const days = filterHistory(all, filter);
    const summary = summarizeHistory(days);

    expect(days.map((day) => day.date)).toEqual(["2026-08-19"]);
    expect(summary.totalExpenses).toBe(1_300);
    expect(header(toBytes(buildHistoryReport({
      days,
      summary,
      periodLabel: "August 19, 2026",
      generatedAt,
    })))).toBe("%PDF-");
  });

  it("exports exactly the days a range filter selected", () => {
    const days = filterHistory(all, {
      mode: "range",
      start: "2026-08-05",
      end: "2026-08-06",
    });

    expect(new Set(days.map((day) => day.date))).toEqual(
      new Set(["2026-08-05", "2026-08-06"]),
    );
    expect(summarizeHistory(days).totalExpenses).toBe(1_450);
  });

  it("drops the other allotments when one is selected", () => {
    const days = filterHistory(all, {
      mode: "range",
      start: "2026-08-01",
      end: "2026-08-31",
      budgetId: "b2",
    });

    expect(days).toHaveLength(1);
    expect(days[0].budgetName).toBe("Daily Expenses");
    expect(summarizeHistory(days).totalExpenses).toBe(400);
  });
});
