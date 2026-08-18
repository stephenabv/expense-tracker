"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/tracker", label: "Tracker" },
  { href: "/budgets", label: "Budgets" },
  { href: "/history", label: "History" },
  { href: "/profile", label: "Account" },
] as const;

/**
 * Shared page frame: content width, header and the Tracker / History switch.
 *
 * Both screens use this so the two halves of the app feel like one product and
 * navigation sits in the same place on each.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Expense Tracker
        </h1>

        {/* Scrolls sideways in its own strip on a narrow phone rather than
            widening the page. */}
        <nav
          aria-label="Sections"
          className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border-subtle bg-surface p-1 shadow-card"
        >
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted hover:bg-surface-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {children}
    </div>
  );
}
