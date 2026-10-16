/**
 * The app's view of src/lib/time: the same functions with the school zone and
 * hours filled in, plus the few helpers that are about this app (Google
 * Calendar links, how a match is described to agents).
 */
import { TIME_ZONE } from "./utils";
import { SCHOOL_HOURS } from "./sla";
import {
  addDays,
  compactUtc,
  dayBounds as dayBoundsIn,
  detectDates as detectDatesIn,
  findSlots as findSlotsIn,
  agendaRows as agendaRowsIn,
  localDay as localDayIn,
  localInstant,
  nextDay,
  tzOffsetMinutes as tzOffsetMinutesIn,
  zoneLabel as zoneLabelIn,
  type Busy,
  type DateMatch,
  type ParseOptions,
  type Slot,
} from "./time";

export {
  addDays,
  compactUtc,
  detectZone,
  detectZones,
  hintOffset,
  icsInvite,
  localInstant,
  nearestZone,
  nextDay,
  offsetLabel,
  shiftMatch,
  weekdayOf,
  type AgendaRow,
  type Busy,
  type DateMatch,
  type Hours,
  type InviteInput,
  type ParseOptions,
  type Slot,
  type ZoneHint,
  type ZoneMention,
} from "./time";

export const tzOffsetMinutes = (date: Date, tz = TIME_ZONE) => tzOffsetMinutesIn(date, tz);
export const zoneLabel = (iso: string, style: "short" | "long" = "short", tz = TIME_ZONE) => zoneLabelIn(iso, tz, style);
export const localDay = (iso: string, tz = TIME_ZONE) => localDayIn(iso, tz);
export const dayBounds = (day: string, tz = TIME_ZONE) => dayBoundsIn(day, tz);

/** Dates in an email, read in the school zone unless the text names another. */
export function detectDates(
  text: string,
  sentAt: Date | string,
  options: Omit<ParseOptions, "sentAt" | "tz"> = {},
): DateMatch[] {
  return detectDatesIn(text, { sentAt, tz: TIME_ZONE, ...options });
}

export function findSlots(busy: Slot[], opts: { from: string; durationMin: number; count?: number; days?: number }): Slot[] {
  return findSlotsIn(busy, { ...opts, tz: TIME_ZONE, hours: SCHOOL_HOURS });
}

export function agendaRows(busy: Busy[], day: string) {
  return agendaRowsIn(busy, day, TIME_ZONE, SCHOOL_HOURS);
}

/** Today's local date plus `offset` days. */
export function dayFromToday(offset: number): string {
  return addDays(localDay(new Date().toISOString()), offset);
}

/** The window to check for conflicts: the mention itself, or an hour from a bare time. */
export function windowFor(m: Pick<DateMatch, "start" | "end" | "allDay">): { start: string; end: string } {
  if (m.allDay) {
    const day = localDay(m.start);
    return { start: localInstant(day, 0, TIME_ZONE).toISOString(), end: localInstant(nextDay(day), 0, TIME_ZONE).toISOString() };
  }
  return { start: m.start, end: m.end ?? new Date(Date.parse(m.start) + 60 * 60_000).toISOString() };
}

/** "Fri, Oct 23, 2:00 PM – 3:00 PM" or "Fri, Oct 23, 2026" for all-day, in the school zone. */
export function describeMatch(m: Pick<DateMatch, "start" | "end" | "allDay">, tz = TIME_ZONE): string {
  const s = new Date(m.start);
  if (m.allDay) {
    return s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz });
  }
  const date = s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return m.end ? `${date}, ${time(s)} – ${time(new Date(m.end))}` : `${date}, ${time(s)}`;
}

/** A Google Calendar "new event" link, prefilled; needs no API access. */
export function googleCalendarLink(input: {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  details?: string;
}): string {
  const window = windowFor(input);
  const dates = input.allDay
    ? `${localDay(input.start).replace(/-/g, "")}/${nextDay(localDay(input.start)).replace(/-/g, "")}`
    : `${compactUtc(window.start)}/${compactUtc(window.end)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: input.title, dates, ctz: TIME_ZONE });
  if (input.details) q.set("details", input.details);
  return `https://calendar.google.com/calendar/render?${q}`;
}
