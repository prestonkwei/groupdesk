/**
 * Free/busy arithmetic over working hours. Pure: callers pass the busy
 * intervals (from freebusy.query or an events list), the zone and the hours.
 */
import { localDay, localInstant, nextDay, weekdayOf } from "./tz";

export type Slot = { start: string; end: string };
/** Minutes after local midnight, e.g. 480–960 for 08:00–16:00. */
export type Hours = { openMin: number; closeMin: number };
export type Busy = { start: string; end: string; title: string | null; allDay: boolean };

/**
 * The first `count` free slots of `durationMin` on weekdays within `hours`,
 * at or after `from`, that overlap no busy interval.
 */
export function findSlots(
  busy: Slot[],
  opts: { from: string; durationMin: number; tz: string; hours: Hours; count?: number; days?: number; stepMin?: number },
): Slot[] {
  const { tz, hours, count = 3, days = 14, stepMin = 30 } = opts;
  const duration = opts.durationMin * 60_000;
  const from = new Date(opts.from);
  const blocks = busy.map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end) }));
  const out: Slot[] = [];
  let day = localDay(from.toISOString(), tz);
  for (let d = 0; d < days && out.length < count; d++, day = nextDay(day)) {
    if (isWeekend(day, tz)) continue;
    for (let m = hours.openMin; m + opts.durationMin <= hours.closeMin && out.length < count; m += stepMin) {
      const start = localInstant(day, m, tz);
      if (start < from) continue;
      const s = start.getTime();
      const e = s + duration;
      if (blocks.some((b) => b.s < e && b.e > s)) continue;
      out.push({ start: start.toISOString(), end: new Date(e).toISOString() });
    }
  }
  return out;
}

export type AgendaRow = { start: string; end: string; free: boolean; title: string | null };

/**
 * Working hours of `day` split into free and busy rows from timed events.
 * All-day events are left to the caller to list separately.
 */
export function agendaRows(busy: Busy[], day: string, tz: string, hours: Hours): AgendaRow[] {
  const open = localInstant(day, hours.openMin, tz).getTime();
  const close = localInstant(day, hours.closeMin, tz).getTime();
  const events = busy
    .filter((b) => !b.allDay)
    .map((b) => ({ s: Math.max(Date.parse(b.start), open), e: Math.min(Date.parse(b.end), close), title: b.title }))
    .filter((b) => b.e > b.s)
    .sort((a, b) => a.s - b.s);

  const rows: AgendaRow[] = [];
  const row = (s: number, e: number, title: string | null, free: boolean) =>
    rows.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), free, title });
  let cursor = open;
  for (const ev of events) {
    if (ev.s > cursor) row(cursor, ev.s, null, true);
    row(ev.s, ev.e, ev.title, false);
    cursor = Math.max(cursor, ev.e);
  }
  if (cursor < close) row(cursor, close, null, true);
  return rows;
}

const isWeekend = (day: string, tz: string) => [0, 6].includes(weekdayOf(day, tz));
