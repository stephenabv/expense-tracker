import { describe, expect, it } from "vitest";

import type { Expense } from "@/types/expense";
import type { HistoryDay } from "@/types/history";
import { buildHistoryReport, historyReportFilename } from "@/lib/pdf/report";
import { summarizeHistory } from "@/lib/history";

function expense(id: string, name: string, amount: number, local: string): Expense {
  return { id, name, amount, createdAt: new Date(local).toISOString() };
}

function day(date: string, expenses: Expense[], budget = 13_000): HistoryDay {
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  return {
    date,
    budget,
    startingBalance: budget,
    endingBalance: budget - total,
    totalExpenses: total,
    expenses,
  };
}

const generatedAt = new Date(2026, 7, 18, 9, 30);

/** Reads the raw PDF bytes so structural assertions can run without a viewer. */
function toBytes(doc: ReturnType<typeof buildHistoryReport>): Uint8Array {
  return new Uint8Array(doc.output("arraybuffer"));
}

function header(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.slice(0, 5));
}

describe("buildHistoryReport", () => {
  const days = [
    day("2026-08-17", [
      expense("1", "Food", 500, "2026-08-17T08:00:00"),
      expense("2", "Transportation", 300, "2026-08-17T10:00:00"),
      expense("3", "Groceries", 1_200, "2026-08-17T12:00:00"),
    ]),
    day("2026-08-16", [expense("4", "Coffee", 150, "2026-08-16T16:00:00")]),
  ];

  it("produces a real PDF document", () => {
    const doc = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 16 – August 17, 2026",
      generatedAt,
    });

    const bytes = toBytes(doc);
    expect(header(bytes)).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });

  it("fits a small report on a single page", () => {
    const doc = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 16 – August 17, 2026",
      generatedAt,
    });

    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("embeds a font that can actually draw the peso sign", () => {
    const doc = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 16 – August 17, 2026",
      generatedAt,
    });

    expect(doc.getFontList()).toHaveProperty("DejaVuSans");

    // jsPDF's built-in faces are WinAnsi-encoded and have no peso sign, so
    // every amount would print blank. A real advance width proves the glyph is
    // present and mapped rather than falling back to notdef.
    for (const style of ["normal", "bold"] as const) {
      doc.setFont("DejaVuSans", style);
      const [pesoWidth] = doc.getCharWidthsArray("₱");
      const [digitWidth] = doc.getCharWidthsArray("8");

      expect(pesoWidth).toBeGreaterThan(0);
      expect(pesoWidth).toBeCloseTo(digitWidth, 5);
    }
  });

  it("can draw the accented characters expense names may contain", () => {
    const accented = [
      day("2026-08-17", [expense("1", "Piña colada", 250, "2026-08-17T08:00:00")]),
    ];

    const doc = buildHistoryReport({
      days: accented,
      summary: summarizeHistory(accented),
      periodLabel: "August 17, 2026",
      generatedAt,
    });

    doc.setFont("DejaVuSans", "normal");
    expect(doc.getCharWidthsArray("ñ")[0]).toBeGreaterThan(0);
    expect(header(toBytes(doc))).toBe("%PDF-");
  });

  it("paginates a large dataset instead of overflowing one page", () => {
    const many = Array.from({ length: 40 }, (_, dayIndex) => {
      const date = `2026-06-${String((dayIndex % 30) + 1).padStart(2, "0")}`;
      return day(
        date,
        Array.from({ length: 8 }, (_, i) =>
          expense(`${dayIndex}-${i}`, `Expense ${i + 1}`, 100 + i, `${date}T09:00:00`),
        ),
      );
    });

    const doc = buildHistoryReport({
      days: many,
      summary: summarizeHistory(many),
      periodLabel: "June 2026",
      generatedAt,
    });

    expect(doc.getNumberOfPages()).toBeGreaterThan(5);
    expect(header(toBytes(doc))).toBe("%PDF-");
  });

  it("handles a day with many expenses spilling across pages", () => {
    const heavy = [
      day(
        "2026-08-17",
        Array.from({ length: 120 }, (_, i) =>
          expense(`e${i}`, `Expense number ${i + 1}`, 25.5, "2026-08-17T09:00:00"),
        ),
      ),
    ];

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

  it("does not fall over on very long expense names", () => {
    const long = [
      day("2026-08-17", [
        expense("1", "A".repeat(60), 500, "2026-08-17T08:00:00"),
        expense("2", "Supercalifragilistic groceries run", 1_200, "2026-08-17T09:00:00"),
      ]),
    ];

    const doc = buildHistoryReport({
      days: long,
      summary: summarizeHistory(long),
      periodLabel: "August 17, 2026",
      generatedAt,
    });

    expect(header(toBytes(doc))).toBe("%PDF-");
  });

  it("exports only the days it is given", () => {
    const filtered = [days[0]];

    const small = buildHistoryReport({
      days: filtered,
      summary: summarizeHistory(filtered),
      periodLabel: "August 17, 2026",
      generatedAt,
    });
    const full = buildHistoryReport({
      days,
      summary: summarizeHistory(days),
      periodLabel: "August 16 – August 17, 2026",
      generatedAt,
    });

    // The filtered report carries strictly less content than the unfiltered one.
    expect(toBytes(small).byteLength).toBeLessThan(toBytes(full).byteLength);
  });

  it("reports the summary of the filtered selection only", () => {
    const filtered = [days[1]];
    const summary = summarizeHistory(filtered);

    expect(summary.totalExpenses).toBe(150);
    expect(summary.expenseCount).toBe(1);
    expect(summary.activeDays).toBe(1);
  });
});

describe("historyReportFilename", () => {
  it("names a single-day export by its date", () => {
    const days = [day("2026-08-17", [expense("1", "Food", 500, "2026-08-17T08:00:00")])];
    expect(historyReportFilename(summarizeHistory(days))).toBe(
      "expense-tracker-history-2026-08-17.pdf",
    );
  });

  it("names a range export by both ends", () => {
    const days = [
      day("2026-08-16", [expense("1", "Food", 500, "2026-08-16T08:00:00")]),
      day("2026-08-17", [expense("2", "Taxi", 100, "2026-08-17T08:00:00")]),
    ];
    expect(historyReportFilename(summarizeHistory(days))).toBe(
      "expense-tracker-history-2026-08-16_to_2026-08-17.pdf",
    );
  });

  it("falls back to the generation date when nothing matched", () => {
    expect(historyReportFilename(summarizeHistory([]), generatedAt)).toBe(
      "expense-tracker-history-20260818.pdf",
    );
  });
});
