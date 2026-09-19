"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export interface InfoTooltipProps {
  /**
   * What the tooltip explains, used to name the trigger for screen readers —
   * "More about Create as budget". The visible label stays short; this is what
   * makes the lone icon meaningful when it is read out of context.
   */
  label: string;
  /** The explanation itself. */
  children: ReactNode;
  className?: string;
}

/**
 * A short label with its explanation one tap away.
 *
 * Forms here carry a sentence or two of guidance under half their controls,
 * which reads as noise once a user knows the screen and pushes the actual
 * fields off a phone. Folding that text behind an icon keeps it available
 * without making everyone scroll past it every time.
 *
 * Hover alone would strand touch users, so the trigger is a real button: a tap,
 * a click or Enter reveals the text, and a mouse also opens it on hover.
 * Escape closes it and stops there — inside a dialog the same key would
 * otherwise dismiss the whole form behind it.
 */
export function InfoTooltip({ label, children, className }: InfoTooltipProps) {
  const id = useId();
  /*
   * Two reasons to be showing, not one.
   *
   * A single `open` flag made the mouse fight itself: moving onto the icon
   * opened the tooltip, and the click that followed toggled it straight back
   * shut. Hovering and pinning are separate states, so a click always leaves
   * the tooltip in the state the user just asked for.
   */
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const open = pinned || hovered;

  const close = useCallback(() => {
    setPinned(false);
    setHovered(false);
  }, []);

  // A tap anywhere else dismisses it, the way every other popover behaves.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <span ref={wrapperRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={`More about ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => (open ? close() : setPinned(true))}
        // Hover is a convenience for pointers; touch already has the tap.
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHovered(false);
        }}
        // Tabbing away closes it; revealing it is the button's own job, so a
        // keyboard user activates it rather than having it spring open on focus.
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          // Without this the dialog behind the tooltip closes as well.
          event.stopPropagation();
          close();
        }}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          "text-muted transition-colors duration-150 hover:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="h-[18px] w-[18px]"
        >
          <circle cx="10" cy="10" r="7.25" />
          <path strokeLinecap="round" d="M10 9.25v4.25" />
          <path strokeLinecap="round" d="M10 6.6h.01" />
        </svg>
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute right-0 top-full z-20 mt-2 w-64 max-w-[min(16rem,70vw)]",
            "rounded-xl border border-border-subtle bg-surface p-3 text-left",
            "text-[0.8125rem] leading-relaxed text-muted-strong shadow-float",
            "animate-fade-in",
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
