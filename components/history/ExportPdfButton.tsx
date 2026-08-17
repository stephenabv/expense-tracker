"use client";

import { useState } from "react";

import type { HistoryDay, HistorySummary } from "@/types/history";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export interface ExportPdfButtonProps {
  /** Exactly the days currently on screen — the PDF must match the filter. */
  days: HistoryDay[];
  summary: HistorySummary;
  periodLabel: string;
}

function DownloadIcon() {
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
      <path d="M10 3.5v9m0 0 3-3m-3 3-3-3M4.5 15.5h11" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 animate-spin"
      fill="none"
    >
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth={2} opacity={0.25} />
      <path
        d="M17 10a7 7 0 0 0-7-7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Generates and downloads the report.
 *
 * jsPDF and its embedded font are pulled in on demand, so the ~60 KB of font
 * data never lands in the initial page bundle.
 */
export function ExportPdfButton({
  days,
  summary,
  periodLabel,
}: ExportPdfButtonProps) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const disabled = days.length === 0;

  const handleExport = async () => {
    if (disabled || busy) return;
    setBusy(true);

    try {
      const { buildHistoryReport, historyReportFilename } = await import(
        "@/lib/pdf/report"
      );

      const doc = buildHistoryReport({ days, summary, periodLabel });
      doc.save(historyReportFilename(summary));

      showToast("PDF report downloaded", "positive");
    } catch (error) {
      console.error("PDF export failed:", error);
      showToast("Could not generate the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <Button
        onClick={handleExport}
        disabled={disabled || busy}
        aria-busy={busy}
        title={
          disabled ? "There is no data to export for this filter." : undefined
        }
      >
        {busy ? <Spinner /> : <DownloadIcon />}
        {busy ? "Generating…" : "Export PDF"}
      </Button>

      {disabled ? (
        <p className="text-[0.8125rem] text-muted sm:text-right">
          Nothing to export for this filter.
        </p>
      ) : null}
    </div>
  );
}
