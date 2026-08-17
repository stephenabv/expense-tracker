"use client";

import { useEffect, useState } from "react";

import type { HistoryFilter, HistoryPreset } from "@/types/history";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { presetToFilter, toDateKey, validateFilter } from "@/lib/history";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ id: HistoryPreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 Days" },
  { id: "thisMonth", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "all", label: "All Time" },
];

type Mode = "single" | "range";

export interface HistoryFilterBarProps {
  filter: HistoryFilter;
  onApply: (filter: HistoryFilter) => void;
}

/**
 * Date controls for the history view.
 *
 * Presets apply immediately because that is the whole point of a shortcut;
 * hand-picked dates wait for Apply so a half-typed range never runs.
 */
export function HistoryFilterBar({ filter, onApply }: HistoryFilterBarProps) {
  const today = toDateKey(new Date());

  const [mode, setMode] = useState<Mode>(
    filter.mode === "range" ? "range" : "single",
  );
  const [single, setSingle] = useState(
    filter.mode === "single" ? filter.date : today,
  );
  const [start, setStart] = useState(
    filter.mode === "range" ? filter.start : today,
  );
  const [end, setEnd] = useState(filter.mode === "range" ? filter.end : today);
  const [error, setError] = useState<string | null>(null);

  // Keep the inputs in step when a preset changes the applied filter.
  useEffect(() => {
    if (filter.mode === "single") {
      setMode("single");
      setSingle(filter.date);
    } else if (filter.mode === "range") {
      setMode("range");
      setStart(filter.start);
      setEnd(filter.end);
    }
    setError(null);
  }, [filter]);

  const draft = (): HistoryFilter =>
    mode === "single"
      ? { mode: "single", date: single }
      : { mode: "range", start, end };

  const handleApply = () => {
    const next = draft();
    const message = validateFilter(next);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    onApply(next);
  };

  const applyPreset = (preset: HistoryPreset) => {
    setError(null);
    onApply(presetToFilter(preset));
  };

  const isPresetActive = (preset: HistoryPreset) => {
    const candidate = presetToFilter(preset);
    if (candidate.mode !== filter.mode) return false;
    if (candidate.mode === "all") return true;
    if (candidate.mode === "single" && filter.mode === "single") {
      return candidate.date === filter.date;
    }
    if (candidate.mode === "range" && filter.mode === "range") {
      return candidate.start === filter.start && candidate.end === filter.end;
    }
    return false;
  };

  return (
    <section
      aria-labelledby="filter-heading"
      className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-card sm:p-5"
    >
      <h2
        id="filter-heading"
        className="text-[0.9375rem] font-semibold tracking-tight text-foreground"
      >
        Filter
      </h2>

      {/* Presets scroll sideways inside their own strip rather than widening
          the page — the layout below stays put on a narrow phone. */}
      <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {PRESETS.map((preset) => {
            const active = isPresetActive(preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                aria-pressed={active}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-foreground text-background"
                    : "bg-surface-muted text-muted-strong ring-1 ring-inset ring-border-subtle hover:text-foreground",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Filter by"
        className="mt-4 inline-flex rounded-xl border border-border-subtle bg-surface-muted p-1"
      >
        {(["single", "range"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              mode === value
                ? "bg-surface text-foreground shadow-card"
                : "text-muted hover:text-foreground",
            )}
          >
            {value === "single" ? "Single date" : "Date range"}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        {mode === "single" ? (
          <DateField
            label="Date"
            value={single}
            max={today}
            invalid={error !== null}
            onChange={(event) => {
              setSingle(event.target.value);
              setError(null);
            }}
          />
        ) : (
          <>
            <DateField
              label="From"
              value={start}
              max={today}
              invalid={error !== null}
              onChange={(event) => {
                setStart(event.target.value);
                setError(null);
              }}
            />
            <DateField
              label="To"
              value={end}
              max={today}
              invalid={error !== null}
              onChange={(event) => {
                setEnd(event.target.value);
                setError(null);
              }}
            />
          </>
        )}

        <div className="flex gap-2 sm:shrink-0">
          <Button onClick={handleApply} className="flex-1 sm:flex-none">
            Apply Filter
          </Button>
          <Button
            variant="secondary"
            onClick={() => applyPreset("all")}
            className="flex-1 sm:flex-none"
          >
            Clear
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
