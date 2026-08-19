import { footerParts } from "@/lib/app-config";

/**
 * The application's identity line.
 *
 * `Expense Tracker | 2026 | v1.0.0 | Build a83f91c`
 *
 * A server component, so the year comes from the render rather than the
 * visitor's clock, and the parts arrive as separate elements: on a narrow
 * screen they wrap onto a second line instead of forcing the page sideways.
 * The separators are decorative and hidden from assistive technology.
 */
export function Footer() {
  const parts = footerParts();

  return (
    // The bottom padding clears the floating Add Expense button, which is
    // fixed over the page and would otherwise sit on top of this line.
    <footer className="mt-10 border-t border-border-subtle pb-24 pt-4 sm:pb-20">
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[0.75rem] text-muted">
        {parts.map((part, index) => (
          <span key={part} className="inline-flex items-center gap-x-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-border-strong">
                |
              </span>
            ) : null}
            <span>{part}</span>
          </span>
        ))}
      </p>
    </footer>
  );
}
