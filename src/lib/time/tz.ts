/**
 * Time-zone arithmetic on top of Intl, with no dependencies and no app
 * configuration: every function takes the IANA zone it works in. Instants
 * are ISO strings or Dates; local days are "YYYY-MM-DD".
 *
 * Assumes an English (en-US / en-CA) Intl: zone names and offsets are read
 * from formatToParts output in those locales.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One Intl.DateTimeFormat per (locale, zone, options): construction is the slow part. */
function formatter(locale: string, tz: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${tz}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, ...options });
    formatters.set(key, f);
  }
  return f;
}

/** Minutes east of UTC for `tz` at `date`, DST-aware ("America/Los_Angeles" in July: -420). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const name = formatter("en-US", tz, { timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+\-\u2212])(\d{2}):?(\d{2})?/);
  if (!m) return 0; // "GMT" itself
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** "UTC+01:00" */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "PDT" (short) or "Pacific Daylight Time" (long) for `tz` at that instant. */
export function zoneLabel(iso: string, tz: string, style: "short" | "long" = "short"): string {
  return (
    formatter("en-US", tz, { timeZoneName: style })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")?.value ?? tz
  );
}

/** The local calendar day of an instant in `tz`. */
export function localDay(iso: string, tz: string): string {
  const parts = formatter("en-CA", tz, { year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const nextDay = (day: string) => addDays(day, 1);

/** The instant of `day` at `minutes` after local midnight in `tz`. */
export function localInstant(day: string, minutes: number, tz: string): Date {
  const base = new Date(`${day}T00:00:00Z`).getTime() + minutes * 60_000;
  // First guess with the offset at that day's noon (right except around a DST
  // switch), then re-read the offset at the guess and correct once.
  const noon = new Date(`${day}T12:00:00Z`);
  let instant = base - tzOffsetMinutes(noon, tz) * 60_000;
  const second = base - tzOffsetMinutes(new Date(instant), tz) * 60_000;
  if (second !== instant) {
    // Take the corrected value if it is self-consistent; otherwise keep the first guess.
    if (base - tzOffsetMinutes(new Date(second), tz) * 60_000 === second) instant = second;
  }
  return new Date(instant);
}

/** Midnight-to-midnight of a local day, as ISO instants. */
export function dayBounds(day: string, tz: string): { start: string; end: string } {
  return { start: localInstant(day, 0, tz).toISOString(), end: localInstant(nextDay(day), 0, tz).toISOString() };
}

/** 0 = Sunday … 6 = Saturday, for a local day. */
export function weekdayOf(day: string, tz: string): number {
  const name = formatter("en-US", tz, { weekday: "short" }).format(localInstant(day, 720, tz));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** ISO instant without separators, as iCalendar and Google Calendar links want it. */
export function compactUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const pad = (n: number) => String(n).padStart(2, "0");
