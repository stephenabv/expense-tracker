import { describe, expect, it } from "vitest";

import { buildHistoryReport, historyReportFilename } from "@/lib/pdf/report";
import { buildHistory, summarizeHistory } from "@/lib/history";
import { budget, expense } from "./helpers";

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
        expense(`${i}-${j}`, b.id, `Expense ${j + 1}`, 100 + j, b.startDate),
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
