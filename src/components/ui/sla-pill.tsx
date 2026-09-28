"use client";

import { AlarmClock } from "lucide-react";
import { slaState } from "@/lib/sla";
import { cn } from "@/lib/utils";

const TONES = {
  overdue: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ok: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

/** Reply-due pill for tickets waiting on us: "Overdue", "Due 2:30 PM", "Due Mon 9 AM". */
export function SlaPill({ dueAt, className }: { dueAt: Date | string; className?: string }) {
  const s = slaState(new Date(dueAt));
  return (
    <span
      title={s.title}
      suppressHydrationWarning
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium",
        TONES[s.tone],
        className,
      )}
    >
      <AlarmClock className="size-3" />
      <span suppressHydrationWarning>{s.label}</span>
    </span>
  );
}
