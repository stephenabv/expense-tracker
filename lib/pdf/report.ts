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
import { sumAmounts } from "@/lib/calculations";
import { formatDateKey } from "@/lib/dates";
import { FULLY_SPENT_LABEL, NO_DATE_PERIOD_LABEL } from "@/lib/budgets";
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
  /**
   * The allotment the history was narrowed to, when the user picked one. Named
   * in the report header so a single-budget export cannot be mistaken for a
   * complete one.
   */
  budgetLabel?: string | null;
  generatedAt?: Date;
}

/**
 * A budget's own applicable period, as printed in the report.
 *
 * Exported because the drawn page cannot be read back — the embedded font is
 * subsetted, so the text in the PDF stream is glyph ids rather than characters.
 * The decisions about *what* to print therefore live in these pure functions,
 * which the tests can check directly, and the renderer below only draws them.
 */
export function budgetPeriodLabel(entry: {
  budgetStartDate: string | null;
  budgetEndDate: string | null;
}): string {
  if (entry.budgetStartDate === null || entry.budgetEndDate === null) {
    return NO_DATE_PERIOD_LABEL;
  }
  if (entry.budgetStartDate === entry.budgetEndDate) {
    return formatDateKey(entry.budgetStartDate);
  }
  return `${formatDateKey(entry.budgetStartDate)} – ${formatDateKey(entry.budgetEndDate)}`;
}

/**
 * How a budget's lifecycle is named in the report.
 *
 * Completed budgets are printed, never filtered out — a report that dropped
 * them would understate what was allocated and spent. The column is what keeps
 * a closed allotment legible next to an open one.
 */
export function budgetStatusLabel(entry: {
  budgetStatus: "active" | "fully_spent";
}): string {
  return entry.budgetStatus === "fully_spent" ? FULLY_SPENT_LABEL : "Active";
}

interface DateGroup {
  date: string;
  entries: HistoryDay[];
  total: number;
  expenseCount: number;
}

/** Groups the selected days by date, preserving the order they arrive in. */
export function groupDaysByDate(input: HistoryDay[]): DateGroup[] {
  const order: string[] = [];
  const byDate = new Map<string, HistoryDay[]>();

  for (const entry of input) {
    const bucket = byDate.get(entry.date);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.date, [entry]);
      order.push(entry.date);
    }
  }

  return order.map((date) => {
    const entries = byDate.get(date)!;
    return {
      date,
      entries,
      total: sumAmounts(entries.map((entry) => entry.totalExpenses)),
      expenseCount: entries.reduce((sum, entry) => sum + entry.expenses.length, 0),
    };
  });
}

const timestampFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "long",
  timeStyle: "short",
});

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
 * The figures printed in the report's summary block.
 *
 * Deliberately no single "balance" row. Each allotment is an independent pot,
 * so one figure for "what is left" across several of them is not a number the
 * user can act on — it would add food money to emergency money and call the
 * result spendable. Spending genuinely does add up across budgets and is
 * reported as such; remaining balances are reported per budget in the table
 * below it.
 */
export function reportSummaryRows(
  summary: HistorySummary,
): Array<[string, string]> {
  return [
    ["Total Allocated Across Budgets", formatCurrency(summary.totalAllocated)],
    ["Total Expenses Across Budgets", formatCurrency(summary.totalExpenses)],
    ["Budgets", String(summary.budgetCount)],
    ["Expense Count", String(summary.expenseCount)],
    ["Active Days", String(summary.activeDays)],
  ];
}

/**
 * Builds the report document.
 *
 * Only the days passed in are printed — the caller supplies exactly what the
 * active filter selected, so the PDF can never show more than the screen does.
 */
export function buildHistoryReport(input: HistoryReportInput): jsPDF {
  const { days, summary, periodLabel } = input;
  const budgetLabel = input.budgetLabel ?? null;
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

  // A report narrowed to one allotment says so on its face; without this a
  // single-budget export reads as the user's complete history.
  if (budgetLabel) {
    y += 20;
    doc.setFont(PDF_FONT_NAME, "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text("BUDGET ALLOTMENT", PAGE_MARGIN, y);

    y += 15;
    doc.setFont(PDF_FONT_NAME, "bold");
    doc.setFontSize(11);
    doc.setTextColor(INK);
    doc.text(budgetLabel, PAGE_MARGIN, y);
  }

  y += 22;
  horizontalRule(doc, y, contentWidth);

  // ---- Summary ------------------------------------------------------------
  y += 20;
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("SUMMARY", PAGE_MARGIN, y);

  y += 20;
  for (const [label, value] of reportSummaryRows(summary)) {
    labelledRow(doc, label, value, y, contentWidth);
    y += 17;
  }

  // ---- Budget summary -----------------------------------------------------
  // Each allotment is its own pot, so the report accounts for them separately
  // before it lists any expense.
  if (summary.budgets.length > 0) {
    y += 6;
    horizontalRule(doc, y, contentWidth);

    y += 22;
    doc.setFont(PDF_FONT_NAME, "bold");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text("BUDGET SUMMARY", PAGE_MARGIN, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: {
        top: PAGE_MARGIN,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
        bottom: PAGE_MARGIN + FOOTER_HEIGHT,
      },
      head: [["Budget", "Period", "Status", "Allocated", "Spent", "Remaining"]],
      // The period column is the budget's own applicability, not the span of
      // its activity: a general allotment says so rather than borrowing the
      // dates of whatever happened to be spent from it.
      body: summary.budgets.map((entry) => [
        entry.budgetName,
        budgetPeriodLabel(entry),
        budgetStatusLabel(entry),
        formatCurrency(entry.budgetAmount),
        formatCurrency(entry.totalExpenses),
        formatCurrency(entry.remaining),
      ]),
      showHead: "everyPage",
      rowPageBreak: "avoid",
      theme: "plain",
      styles: {
        font: PDF_FONT_NAME,
        fontSize: 9,
        cellPadding: { top: 5, right: 6, bottom: 5, left: 0 },
        textColor: INK,
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
      columnStyles: {
        0: { cellWidth: contentWidth - 404, fontStyle: "bold" },
        1: { cellWidth: 120, textColor: MUTED, fontSize: 8.5 },
        2: { cellWidth: 64, textColor: MUTED, fontSize: 8.5 },
        3: { cellWidth: 72, halign: "right" },
        4: { cellWidth: 72, halign: "right" },
        5: { cellWidth: 76, halign: "right", fontStyle: "bold" },
      },
    });

    const summaryY = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable?.finalY;
    y = typeof summaryY === "number" ? summaryY + 6 : y + 40;
  }

  y += 6;
  horizontalRule(doc, y, contentWidth);

  // ---- Expense details ----------------------------------------------------
  y += 22;
  doc.setFont(PDF_FONT_NAME, "bold");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("EXPENSE DETAILS", PAGE_MARGIN, y);
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

  /*
   * Details are grouped by date, then by budget within the date.
   *
   * Two allotments can fund spending on the same day, so a bare date heading
   * would leave the reader unable to tell which pot a row came out of. Each
   * budget gets its own block and its own subtotal; the date total is printed
   * only when there is more than one, where it is genuinely new information
   * rather than a repeat of the subtotal directly above it.
   */
  for (const group of groupDaysByDate(days)) {
    const multipleBudgets = group.entries.length > 1;

    // Keep a date heading with at least the first rows of its table; starting a
    // date at the very bottom of a page reads as an orphan.
    const headingBlock = 90;
    if (y + headingBlock > maxY) {
      doc.addPage();
      y = PAGE_MARGIN + 6;
    }

    y += 20;
    doc.setFont(PDF_FONT_NAME, "bold");
    doc.setFontSize(11);
    doc.setTextColor(INK);
    doc.text(formatDateKey(group.date), PAGE_MARGIN, y);

    doc.setFont(PDF_FONT_NAME, "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    const countLabel =
      group.expenseCount === 1 ? "1 expense" : `${group.expenseCount} expenses`;
    doc.text(
      `${countLabel} · ${formatCurrency(group.total)}`,
      PAGE_MARGIN + contentWidth,
      y,
      { align: "right" },
    );

    for (const day of group.entries) {
      // Name the allotment above every block of rows, with its applicability,
      // so the money is always traceable to the pot it left.
      y += 15;
      doc.setFont(PDF_FONT_NAME, "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(INK);
      doc.text(day.budgetName, PAGE_MARGIN, y);

      doc.setFont(PDF_FONT_NAME, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(MUTED);
      doc.text(
        day.budgetStatus === "fully_spent"
          ? `${budgetPeriodLabel(day)} · ${FULLY_SPENT_LABEL}`
          : budgetPeriodLabel(day),
        PAGE_MARGIN + contentWidth,
        y,
        { align: "right" },
      );

      y += 6;

      autoTable(doc, {
        startY: y,
        margin: {
          top: PAGE_MARGIN,
          left: PAGE_MARGIN,
          right: PAGE_MARGIN,
          bottom: PAGE_MARGIN + FOOTER_HEIGHT,
        },
        head: [["Expense", "Amount"]],
        body: day.expenses.map((expense) => [
          expense.name,
          formatCurrency(expense.amount),
        ]),
        foot: [
          [
            multipleBudgets ? `${day.budgetName} Total` : "Daily Total",
            formatCurrency(day.totalExpenses),
          ],
        ],
        // Repeat the column headers when a block spills onto a new page.
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
          0: { cellWidth: contentWidth - 120 },
          1: { cellWidth: 120, halign: "right" },
        },
      });

      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } })
        .lastAutoTable?.finalY;
      y = typeof finalY === "number" ? finalY + 8 : y + 40;
    }

    if (multipleBudgets) {
      if (y + 24 > maxY) {
        doc.addPage();
        y = PAGE_MARGIN + 6;
      }
      y += 8;
      labelledRow(doc, "Daily Total", formatCurrency(group.total), y, contentWidth);
      y += 10;
    }
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
