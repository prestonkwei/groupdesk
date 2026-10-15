/**
 * Finds dates and times in prose with chrono-node and resolves each to an
 * instant, taking the zone from (in order) the time itself ("3pm EST"), a
 * zone named nearby in the text ("I'm in Central time"), or the fallback
 * zone the caller supplies. Pure and browser-safe. Needs chrono-node (the
 * toolkit's one dependency); the other modules don't import this file.
 * Times are read as written and zoned per date, so DST is applied for the day
 * meant, not the day the email was sent. Phrases already in the past when the
 * email was sent ("last Friday", "the Oct 10 incident") are not returned.
 */
import * as chrono from "chrono-node";
import { localDay, localInstant, tzOffsetMinutes } from "./tz";
import { detectZone, detectZones, nearestZone, type ZoneMention } from "./zones";

export type DateMatch = {
  /** Offset of `text` in the scanned string. */
  index: number;
  text: string;
  /** ISO instants. `end` is null when only a start was mentioned. */
  start: string;
  end: string | null;
  /** No time of day was given: show and book it as an all-day event. */
  allDay: boolean;
  /** Where the zone came from: written with the time, named elsewhere in the text, or assumed. */
  tzSource: "inline" | "message" | "assumed";
  /** False only when the zone was assumed. */
  tzCertain: boolean;
  /** What the text called the zone, when it named one ("Central time (Nashville)"). */
  zoneName?: string;
  /** Offset the time was read in, minutes east of UTC. */
  offsetMin: number;
};

export type ParseOptions = {
  /** "Now" for relative phrases: the email's send time. */
  sentAt: Date | string;
  /** IANA zone for times that name none. */
  tz: string;
  /** When `text` is a piece of a larger document: that document, its zone mentions, and where `text` starts in it. */
  whole?: string;
  zones?: ZoneMention[];
  baseIndex?: number;
};

/** Phrases chrono parses that nobody means as a calendar entry. */
const NOISE =
  /^(now|today|tonight|yesterday|this (morning|afternoon|evening)|(the )?(morning|afternoon|evening|night)|(a|one) (second|minute|hour|day|week|month|year)|.*\bago|\d{1,2}(:\d{2})?\s?(am|pm))$/i;

/** chrono keeps the preposition ("on Friday at 2pm"); the match reads better without it. */
const LEADING_PREPOSITION = /^(on|at|by|from|until|till|before|after)\s+/i;

const MAX_TEXT = 50_000;

/** A mention that ended this long before the email was sent is history, not a plan. */
const GRACE_MIN = 60;

/** Phrases that point backwards; never read forward. */
const BACKWARD = /\b(last|previous|past|ago|earlier|yesterday)\b/i;
/** "this Thursday" said on a Thursday means today; chrono already picks this week's day. */
const THIS_WEEK = /^\s*this\b/i;

type Wall = { y: number; mo: number; d: number; h: number; mi: number };
type Zone = { tz: string } | { offsetMin: number };

/** chrono's components as wall-clock numbers (what was written, in no particular zone). */
function wallOf(c: chrono.ParsedComponents): Wall {
  return { y: c.get("year")!, mo: c.get("month")!, d: c.get("day")!, h: c.get("hour") ?? 12, mi: c.get("minute") ?? 0 };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The instant a wall-clock time is in `zone`, using the zone's offset on that date (DST-aware). */
function instantIn(w: Wall, zone: Zone): Date {
  if ("tz" in zone) return localInstant(`${w.y}-${pad2(w.mo)}-${pad2(w.d)}`, w.h * 60 + w.mi, zone.tz);
  return new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - zone.offsetMin * 60_000);
}

export function detectDates(text: string, options: ParseOptions): DateMatch[] {
  if (!text || text.length > MAX_TEXT) return [];
  const ref = new Date(options.sentAt);
  // Only used so "today"/"Friday" resolve against the right local day; the
  // written times are read as wall-clock and zoned per date below.
  const sendOffset = tzOffsetMinutes(ref, options.tz);
  const whole = options.whole ?? text;
  const zones = options.zones ?? detectZones(whole);
  const base = options.baseIndex ?? 0;
  const context = { instant: ref, timezone: sendOffset };

  const results = chrono.parse(text, context);
  // "Friday" alone means the coming one, but "last Friday" must stay in the past.
  const forward = chrono.parse(text, context, { forwardDate: true });
  // A zone written as part of a time ("11 AM PST") belongs to that time only.
  const inlineSpans = results
    .filter((r) => r.start.isCertain("timezoneOffset"))
    .map((r) => ({ index: base + r.index, length: r.text.length }));

  const sentDay = localDay(ref.toISOString(), options.tz);
  const out: DateMatch[] = [];
  for (const found of results) {
    if (NOISE.test(found.text.trim())) continue;
    // A bare "12" or "May" is too easy a false positive; insist on a day.
    if (!found.start.isCertain("day") && !found.start.isCertain("weekday")) continue;

    // A bare weekday that came out in the past is read forward ("Monday at 9"
    // sent on Tuesday). Without a definite time the day is what counts, so
    // "Thursday morning" sent on Thursday at 9am is today, not next week.
    let r = found;
    const cameOutPast = found.start.isCertain("hour")
      ? found.start.date().getTime() < ref.getTime() - GRACE_MIN * 60_000
      : localDay(found.start.date().toISOString(), options.tz) < sentDay;
    if (
      found.start.isCertain("weekday") &&
      !found.start.isCertain("day") &&
      !BACKWARD.test(found.text) &&
      !THIS_WEEK.test(found.text) &&
      cameOutPast
    ) {
      r = forward.find((f) => f.index === found.index && f.text === found.text) ?? found;
    }

    const allDay = !r.start.isCertain("hour");
    const inline = r.start.isCertain("timezoneOffset");
    let zone: Zone = { tz: options.tz };
    let tzSource: DateMatch["tzSource"] = "assumed";
    let zoneName: string | undefined;
    let start: Date;
    let end: Date | undefined;

    if (inline) {
      // "11 AM PST" in October means Pacific time, i.e. PDT. chrono takes the
      // abbreviation literally (-8); use the named zone's real offset that day.
      tzSource = "inline";
      start = r.start.date();
      end = r.end?.date();
      const named = detectZone(r.text);
      if (named && "tz" in named) {
        zone = named;
        start = instantIn(wallOf(r.start), zone);
        end = r.end ? instantIn(wallOf(r.end), zone) : undefined;
      } else {
        zone = { offsetMin: r.start.get("timezoneOffset") ?? sendOffset };
      }
    } else {
      if (!allDay) {
        const hint = nearestZone(zones, base + r.index, whole, inlineSpans);
        if (hint) {
          zone = "tz" in hint ? { tz: hint.tz } : { offsetMin: hint.offsetMin };
          tzSource = "message";
          zoneName = hint.name;
        }
      }
      start = instantIn(wallOf(r.start), zone);
      end = r.end ? instantIn(wallOf(r.end), zone) : undefined;
    }

    // Already over when the email was sent: a reference to the past, not a plan.
    const over = allDay ? localDay(start.toISOString(), options.tz) < sentDay : (end ?? start).getTime() < ref.getTime() - GRACE_MIN * 60_000;
    if (over) continue;

    const lead = r.text.match(LEADING_PREPOSITION)?.[0].length ?? 0;
    out.push({
      index: r.index + lead,
      text: r.text.slice(lead),
      start: start.toISOString(),
      end: endAfter(start, end),
      allDay,
      offsetMin: "tz" in zone ? tzOffsetMinutes(start, zone.tz) : zone.offsetMin,
      tzSource,
      tzCertain: tzSource !== "assumed",
      zoneName,
    });
  }
  return out;
}

function endAfter(start: Date, end: Date | undefined): string | null {
  return end && end.getTime() > start.getTime() ? end.toISOString() : null;
}

/**
 * The same written time read in another zone: "2pm" meant at UTC+1 instead of
 * UTC-7 is 8 hours earlier as an instant. All-day matches don't move.
 */
export function shiftMatch<T extends Pick<DateMatch, "start" | "end" | "allDay" | "offsetMin">>(m: T, toOffsetMin: number): T {
  if (m.allDay || m.offsetMin === toOffsetMin) return m;
  const delta = (m.offsetMin - toOffsetMin) * 60_000;
  const move = (iso: string) => new Date(new Date(iso).getTime() + delta).toISOString();
  return { ...m, start: move(m.start), end: m.end ? move(m.end) : null, offsetMin: toOffsetMin };
}
