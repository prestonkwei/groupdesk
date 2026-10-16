"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { agenda, type Agenda } from "@/lib/actions/calendar";
import { agendaRows, dayFromToday } from "@/lib/dates";
import { TIME_ZONE, cn } from "@/lib/utils";

/**
 * Sidebar "Calendar" row: a dropdown with the signed-in agent's free and busy
 * stretches of school hours for a day, from their connected Google Calendar.
 */
export function CalendarPeek({ connected }: { connected: boolean }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const pathname = usePathname();
  const day = dayFromToday(offset);
  // Bumped on every open and on Retry, so each looks at the calendar afresh.
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ day: string; nonce: number; data: Agenda } | null>(null);
  const data = loaded?.day === day && loaded.nonce === nonce ? loaded.data : null;

  useEffect(() => {
    if (!open || !connected) return;
    let cancelled = false;
    agenda(day)
      .catch((): Agenda => ({ connected: true, error: "Couldn't load your calendar." }))
      .then((d) => {
        if (!cancelled) setLoaded({ day, nonce, data: d });
      });
    return () => {
      cancelled = true;
    };
  }, [open, connected, day, nonce]);

  const connectHref = `/api/calendar/connect?next=${encodeURIComponent(pathname)}`;
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setNonce((n) => n + 1);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--accent)]",
            open && "bg-[var(--accent)]",
          )}
        >
          <CalendarDays className="size-4 text-[var(--muted-foreground)]" />
          <span className="flex-1">Calendar</span>
          <ChevronRight className={cn("size-3.5 text-[var(--muted-foreground)] transition-transform", open && "rotate-90")} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-sm shadow-lg"
        >
          {!connected ? (
            <p className="px-1 py-1 text-xs text-[var(--muted-foreground)]">
              <a href={connectHref} className="font-medium text-[var(--primary)] underline">
                Connect Google Calendar
              </a>{" "}
              to see your free and busy times here.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => setOffset((o) => o - 1)}
                  className="rounded p-1 hover:bg-[var(--accent)]"
                  aria-label="Previous day"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(0)}
                  className="flex-1 truncate text-center font-medium hover:underline"
                  title="Back to today"
                >
                  {offset === 0 ? "Today" : label}
                  {offset === 0 && <span className="ml-1 text-xs font-normal text-[var(--muted-foreground)]">{label}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setOffset((o) => o + 1)}
                  className="rounded p-1 hover:bg-[var(--accent)]"
                  aria-label="Next day"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <div className="mt-1.5 text-xs">
                {!data && (
                  <p className="inline-flex items-center gap-1.5 px-1 py-1 text-[var(--muted-foreground)]">
                    <Loader2 className="size-3.5 animate-spin" /> Loading…
                  </p>
                )}
                {data && !data.connected && (
                  <p className="px-1 py-1 text-[var(--muted-foreground)]">
                    <a href={connectHref} className="text-[var(--primary)] underline">
                      Connect Google Calendar
                    </a>
                  </p>
                )}
                {data && data.connected && "error" in data && (
                  <p className="px-1 py-1 text-[var(--destructive)]">
                    {data.error}{" "}
                    <button type="button" onClick={() => setNonce((n) => n + 1)} className="underline">
                      Retry
                    </button>
                  </p>
                )}
                {data && data.connected && "busy" in data && (
                  <DayRows busy={data.busy} day={day} time={time} />
                )}
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DayRows({
  busy,
  day,
  time,
}: {
  busy: Parameters<typeof agendaRows>[0];
  day: string;
  time: (iso: string) => string;
}) {
  const allDay = busy.filter((b) => b.allDay);
  // The weekday of a calendar date doesn't depend on the zone.
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  // No school on a weekend: only show what's actually booked then.
  const rows = weekend ? agendaRows(busy, day).filter((r) => !r.free) : agendaRows(busy, day);
  return (
    <ul className="space-y-px">
      {weekend && !rows.length && (
        <li className="px-1.5 py-1 text-[var(--muted-foreground)]">Weekend</li>
      )}
      {allDay.map((b, i) => (
        <li key={`a${i}`} className="flex gap-2 rounded px-1.5 py-1 bg-amber-100/70 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          <span className="w-24 shrink-0 text-[var(--muted-foreground)]">all day</span>
          <span className="truncate font-medium">{b.title ?? "(busy)"}</span>
        </li>
      ))}
      {rows.map((r) => (
        <li
          key={r.start}
          className={cn(
            "flex gap-2 rounded px-1.5 py-1",
            r.free
              ? "text-emerald-800 dark:text-emerald-300"
              : "bg-amber-100/70 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
          )}
        >
          <span className={cn("w-24 shrink-0 tabular-nums", r.free ? "opacity-70" : "text-[var(--muted-foreground)]")}>
            {time(r.start)}–{time(r.end)}
          </span>
          <span className="truncate font-medium">{r.free ? "Free" : r.title ?? "(busy)"}</span>
        </li>
      ))}
    </ul>
  );
}
