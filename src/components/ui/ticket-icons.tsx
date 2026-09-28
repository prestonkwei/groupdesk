import { cn } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/db/schema";

/**
 * Solved means we helped; closed means it was never a real request
 * (notifications, newsletters, spam). Reports leave closed tickets out.
 */
export const STATUSES: { value: TicketStatus; label: string; hint: string }[] = [
  { value: "open", label: "Open", hint: "Needs a reply" },
  { value: "pending", label: "Pending", hint: "Waiting on them" },
  { value: "solved", label: "Solved", hint: "Done" },
  { value: "closed", label: "Closed", hint: "Not a request" },
];

export const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "p0", label: "Critical" },
  { value: "p1", label: "High" },
  { value: "p2", label: "Medium" },
  { value: "p3", label: "Low" },
  { value: "none", label: "No priority" },
];

/** Linear-style status glyph: hollow → half → filled check → muted. */
export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const common = cn("size-3.5 shrink-0", `status-${status}`, className);
  switch (status) {
    case "open":
      return (
        <svg viewBox="0 0 14 14" className={common} aria-hidden>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--status)" strokeWidth="1.8" />
        </svg>
      );
    case "pending":
      return (
        <svg viewBox="0 0 14 14" className={common} aria-hidden>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--status)" strokeWidth="1.8" />
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill="var(--status)" />
        </svg>
      );
    case "solved":
      return (
        <svg viewBox="0 0 14 14" className={common} aria-hidden>
          <circle cx="7" cy="7" r="6.5" fill="var(--status)" />
          <path d="M4.3 7.2 6.2 9 9.8 5.2" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 14 14" className={common} aria-hidden>
          <circle cx="7" cy="7" r="6.5" fill="var(--status)" />
          <path d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

const PRIORITY_TONE: Record<string, string> = {
  p0: "bg-rose-600 text-white dark:bg-rose-500",
  p1: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  p2: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  p3: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/** "P0"–"P3" chip, loudest for P0; three dashes when there's no priority. */
export function PriorityIcon({ priority, className }: { priority: string; className?: string }) {
  if (!PRIORITY_TONE[priority]) {
    return (
      <svg
        viewBox="0 0 14 14"
        className={cn("size-3.5 shrink-0 text-[var(--muted-foreground)]", className)}
        aria-hidden
      >
        {[2, 6, 10].map((x) => (
          <rect key={x} x={x} y="6.3" width="2.4" height="1.4" rx="0.7" fill="currentColor" />
        ))}
      </svg>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-6 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold leading-none",
        PRIORITY_TONE[priority],
        className,
      )}
    >
      {priority.toUpperCase()}
    </span>
  );
}
