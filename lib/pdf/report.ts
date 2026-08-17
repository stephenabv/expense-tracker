/**
 * Financial history report.
 *
 * Produces a real, paginated PDF document — vector text that stays selectable
 * and searchable — rather than an image of the page. Kept free of React and
 * browser APIs so it can be exercised directly in tests.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { HistoryDay, HistorySummary } from "@/types/history";
import { formatCurrency } from "@/lib/currency";
import { formatDateKey } from "@/lib/history";
import {
  PDF_FONT_BOLD_BASE64,
  PDF_FONT_NAME,
  PDF_FONT_REGULAR_BASE64,
} from "@/lib/pdf/font";

const PAGE_MARGIN = 48;
const FOOTER_HEIGHT = 34;

const INK = "#0d1117";
const MUTED = "#6b7280";
const RULE = "#d4d7dd";

export interface HistoryReportInput {
  /** Days to include, in the order they should be printed (newest first). */
  days: HistoryDay[];
  summary: HistorySummary;
  /** Human label for the active filter, e.g. `August 1 – August 17, 2026`. */
  periodLabel: string;
  generatedAt?: Date;
}

const timestampFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "long",
  timeStyle: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

/**
 * Registers the embedded font.
 *
 * jsPDF's built-in faces are WinAnsi-encoded and have no peso sign, so every
 * amount would print as a missing glyph without this.
 */
function registerFont(doc: jsPDF): void {
  doc.addFileToVFS("DejaVuSans.ttf", PDF_FONT_REGULAR_BASE64);
  doc.addFont("DejaVuSans.ttf", PDF_FONT_NAME, "normal");

  doc.addFileToVFS("DejaVuSans-Bold.ttf", PDF_FONT_BOLD_BASE64);
  doc.addFont("DejaVuSans-Bold.ttf", PDF_FONT_NAME, "bold");

  doc.setFont(PDF_FONT_NAME, "normal");
}

function horizontalRule(doc: jsPDF, y: number, width: number): void {
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.75);
  doc.line(PAGE_MARGIN, y, PAGE_MARGIN + width, y);
}

/** Label left, value right — the layout used throughout the summary block. */
function labelledRow(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  width: number,
): void {
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text(label, PAGE_MARGIN, y);

  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setTextColor(INK);
  doc.text(value, PAGE_MARGIN + width, y, { align: "right" });
}

/** Draws the page number and generation stamp on every page, once at the end. */
function paintFooters(doc: jsPDF, generatedAt: Date): void {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const baseline = pageHeight - PAGE_MARGIN + 12;

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);

    doc.setDrawColor(RULE);
    doc.setLineWidth(0.5);
    doc.line(PAGE_MARGIN, baseline - 12, PAGE_MARGIN + contentWidth, baseline - 12);

    doc.setFont(PDF_FONT_NAME, "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(
      `Generated ${timestampFormatter.format(generatedAt)}`,
      PAGE_MARGIN,
      baseline,
    );
    doc.text(
      `Page ${page} of ${pageCount}`,
      PAGE_MARGIN + contentWidth,
      baseline,
      { align: "right" },
    );
  }
}

/**
 * Builds the report document.
 *
 * Only the days passed in are printed — the caller supplies exactly what the
 * active filter selected, so the PDF can never show more than the screen does.
 */
export function buildHistoryReport(input: HistoryReportInput): jsPDF {
  const { days, summary, periodLabel } = input;
  const generatedAt = input.generatedAt ?? new Date();

  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  registerFont(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const maxY = pageHeight - PAGE_MARGIN - FOOTER_HEIGHT;

  doc.setProperties({
    title: `Expense Tracker — Financial History Report`,
    subject: periodLabel,
    creator: "Expense Tracker",
  });

  let y = PAGE_MARGIN + 6;

  // ---- Masthead -----------------------------------------------------------
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(18);
  doc.setTextColor(INK);
  doc.text("EXPENSE TRACKER", PAGE_MARGIN, y);

  y += 18;
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(11);
  doc.setTextColor(MUTED);
  doc.text("Financial History Report", PAGE_MARGIN, y);

  y += 22;
  horizontalRule(doc, y, contentWidth);

  // ---- Period -------------------------------------------------------------
  y += 20;
  doc.setFont(PDF_FONT_NAME, "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("PERIOD", PAGE_MARGIN, y);

  y += 16;
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(13);
  doc.setTextColor(INK);
  doc.text(periodLabel, PAGE_MARGIN, y);

  y += 22;
  horizontalRule(doc, y, contentWidth);

  // ---- Summary ------------------------------------------------------------
  y += 20;
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("SUMMARY", PAGE_MARGIN, y);

  y += 20;
  const summaryRows: Array<[string, string]> = [
    ["Starting Budget", formatCurrency(summary.startingBudget)],
    ["Starting Balance", formatCurrency(summary.startingBalance)],
    ["Total Expenses", formatCurrency(summary.totalExpenses)],
    ["Ending Balance", formatCurrency(summary.endingBalance)],
    ["Expense Count", String(summary.expenseCount)],
    ["Active Days", String(summary.activeDays)],
  ];

  for (const [label, value] of summaryRows) {
    labelledRow(doc, label, value, y, contentWidth);
    y += 17;
  }

  y += 6;
  horizontalRule(doc, y, contentWidth);

  // ---- Daily breakdown ----------------------------------------------------
  y += 22;
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("DAILY BREAKDOWN", PAGE_MARGIN, y);
  y += 8;

  if (days.length === 0) {
    y += 16;
    doc.setFont(PDF_FONT_NAME, "normal");
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text("No tracker activity in this period.", PAGE_MARGIN, y);
    paintFooters(doc, generatedAt);
    return doc;
  }

  for (const day of days) {
    // Keep a day heading with at least the first rows of its table; starting a
    // day at the very bottom of a page reads as an orphan.
    const headingBlock = 58;
    if (y + headingBlock > maxY) {
      doc.addPage();
      y = PAGE_MARGIN + 6;
    }

    y += 20;
    doc.setFont(PDF_FONT_NAME, "bold");
    doc.setFontSize(11);
    doc.setTextColor(INK);
    doc.text(formatDateKey(day.date), PAGE_MARGIN, y);

    doc.setFont(PDF_FONT_NAME, "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    const countLabel =
      day.expenses.length === 1 ? "1 expense" : `${day.expenses.length} expenses`;
    doc.text(
      `${countLabel} · ${formatCurrency(day.totalExpenses)}`,
      PAGE_MARGIN + contentWidth,
      y,
      { align: "right" },
    );

    y += 10;

    autoTable(doc, {
      startY: y,
      margin: {
        top: PAGE_MARGIN,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
        bottom: PAGE_MARGIN + FOOTER_HEIGHT,
      },
      head: [["Expense", "Time", "Amount"]],
      body: day.expenses.map((expense) => [
        expense.name,
        formatTime(expense.createdAt),
        formatCurrency(expense.amount),
      ]),
      foot: [["Daily Total", "", formatCurrency(day.totalExpenses)]],
      // Repeat the column headers when a day's table spills onto a new page.
      showHead: "everyPage",
      showFoot: "lastPage",
      rowPageBreak: "avoid",
      theme: "plain",
      styles: {
        font: PDF_FONT_NAME,
        fontSize: 9.5,
        cellPadding: { top: 5, right: 6, bottom: 5, left: 0 },
        textColor: INK,
        // Long names wrap instead of being cut off.
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        font: PDF_FONT_NAME,
        fontStyle: "normal",
        fontSize: 8,
        textColor: MUTED,
        lineWidth: { bottom: 0.75 },
        lineColor: RULE,
      },
      footStyles: {
        font: PDF_FONT_NAME,
        fontStyle: "bold",
        fontSize: 9.5,
        textColor: INK,
        lineWidth: { top: 0.75 },
        lineColor: RULE,
      },
      columnStyles: {
        0: { cellWidth: contentWidth - 190 },
        1: { cellWidth: 80, textColor: MUTED },
        2: { cellWidth: 110, halign: "right" },
      },
    });

    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable?.finalY;
    y = typeof finalY === "number" ? finalY + 8 : y + 40;
  }

  paintFooters(doc, generatedAt);
  return doc;
}

/** A filesystem-safe filename derived from the period being reported. */
export function historyReportFilename(
  summary: HistorySummary,
  generatedAt: Date = new Date(),
): string {
  const stamp = (date: Date) =>
    `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, "0")}${`${date.getDate()}`.padStart(2, "0")}`;

  if (summary.firstDate && summary.lastDate) {
    const span =
      summary.firstDate === summary.lastDate
        ? summary.firstDate
        : `${summary.firstDate}_to_${summary.lastDate}`;
    return `expense-tracker-history-${span}.pdf`;
  }

  return `expense-tracker-history-${stamp(generatedAt)}.pdf`;
}
