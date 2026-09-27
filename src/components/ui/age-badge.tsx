import { cn } from "@/lib/utils";

const DAY = 24 * 60 * 60 * 1000;

/** Under 3 days green, 3–5 days yellow, 5+ days red. Resolved tickets stay grey. */
export function ageTone(since: Date | string, resolved: boolean) {
  if (resolved) return "bg-[var(--muted)] text-[var(--muted-foreground)]";
  const days = (Date.now() - new Date(since).getTime()) / DAY;
  if (days >= 5) return "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300";
  if (days >= 3) return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
}

function shortAge(since: Date | string) {
  const ms = Date.now() - new Date(since).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(min, 1)}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/**
 * The day the email came in plus a coloured age pill, e.g. "Sep 17 [10d]".
 */
export function AgeBadge({
  since,
  resolved,
  showDate = true,
  className,
}: {
  since: Date | string;
  resolved: boolean;
  showDate?: boolean;
  className?: string;
}) {
  const d = new Date(since);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs", className)}
      title={`Came in ${d.toLocaleString()}`}
    >
      {showDate && (
        <span className="text-[var(--muted-foreground)]">
          {d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            ...(sameYear ? {} : { year: "2-digit" }),
          })}
        </span>
      )}
      <span
        className={cn(
          "min-w-8 rounded-full px-1.5 py-px text-center font-medium tabular-nums",
          ageTone(since, resolved),
        )}
      >
        {shortAge(since)}
      </span>
    </span>
  );
}
