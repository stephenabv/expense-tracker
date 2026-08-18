import { cn } from "@/lib/utils";

/** Banner above a form, for outcomes that are not tied to one field. */
export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border p-3.5 text-sm",
        tone === "error" && "border-danger/30 bg-danger-soft text-danger",
        tone === "success" && "border-positive/30 bg-positive-soft text-positive",
        tone === "info" &&
          "border-border-subtle bg-surface-muted text-muted-strong",
      )}
    >
      {children}
    </div>
  );
}
