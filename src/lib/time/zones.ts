/**
 * Finds time zones people name in prose ("I'm in Central time", "(Nashville)",
 * "3pm EST", "UK time", "GMT+2") and decides which mention, if any, describes
 * a given time in the text. No app configuration and no dependencies; the
 * vocabulary below is the only knowledge, and it's meant to be extended.
 * It is English-only (and US-centric): phrases and abbreviations are matched
 * as written in English.
 */
import { tzOffsetMinutes } from "./tz";

/** A zone someone named: an IANA zone, or a fixed offset for "UTC+2". */
export type ZoneHint = { name: string; tz: string } | { name: string; offsetMin: number };
export type ZoneMention = ZoneHint & { index: number; length: number };

/* ------------------------------------------------------------- vocabulary */

/**
 * One entry per zone: the words that mean it. `abbr` is the base letter of
 * the US abbreviations (E → EST/EDT/ET); `region` the spoken name; `words`
 * anything that stands alone (abbreviations, "UK time"); `cities` places,
 * which only count after "in"/"from"/"near" or before "time" ("Hi Charlotte"
 * is a greeting, "in Charlotte" a location).
 */
type ZoneWords = { tz: string; abbr?: string; region?: string; words?: string[]; cities?: string[] };

const VOCABULARY: ZoneWords[] = [
  { tz: "America/Los_Angeles", abbr: "P", region: "Pacific", cities: ["Los Angeles", "Seattle", "San Francisco", "Portland", "Las Vegas", "San Diego"] },
  { tz: "America/Denver", abbr: "M", region: "Mountain", cities: ["Denver", "Salt Lake City", "Boise", "Albuquerque"] },
  { tz: "America/Phoenix", cities: ["Phoenix", "Arizona"] },
  { tz: "America/Chicago", abbr: "C", region: "Central", cities: ["Nashville", "Chicago", "Dallas", "Houston", "Austin", "Minneapolis", "St. Louis", "St Louis", "Kansas City", "New Orleans", "Memphis", "Milwaukee", "Oklahoma City"] },
  { tz: "America/New_York", abbr: "E", region: "Eastern", words: ["NYC"], cities: ["New York", "Boston", "Atlanta", "Miami", "Philadelphia", "Washington DC", "Washington, D.C.", "Toronto", "Detroit", "Charlotte", "Orlando", "Pittsburgh"] },
  { tz: "America/Anchorage", words: ["AKST", "AKDT"], cities: ["Alaska", "Anchorage"] },
  { tz: "Pacific/Honolulu", words: ["HST"], cities: ["Hawaii", "Honolulu"] },
  { tz: "Europe/London", words: ["BST", "UK time"], cities: ["London", "Edinburgh", "Dublin"] },
  { tz: "UTC", words: ["UTC", "GMT", "Zulu"] },
  { tz: "Europe/Paris", words: ["CET", "CEST"], cities: ["Paris", "Berlin", "Amsterdam", "Madrid", "Rome", "Brussels", "Vienna", "Zurich", "Stockholm", "Copenhagen", "Oslo", "Warsaw", "Prague"] },
  { tz: "Asia/Kolkata", words: ["IST", "India time"], cities: ["Mumbai", "Bangalore", "Bengaluru", "Delhi", "Kolkata"] },
  { tz: "Asia/Tokyo", words: ["JST", "Japan time"], cities: ["Tokyo"] },
  { tz: "Australia/Sydney", words: ["AEST", "AEDT"], cities: ["Sydney", "Melbourne", "Brisbane"] },
  { tz: "Asia/Singapore", words: ["SGT", "HKT"], cities: ["Singapore", "Hong Kong"] },
];

/* ---------------------------------------------------------------- patterns */

/** Phrases that introduce a zone: "I'm in Central", "we're on CT". */
const CUE = String.raw`(?:here in|I'?m (?:in|on)|we'?re (?:in|on)|I am (?:in|on)|in|on|from|to)`;
/** Stronger cue for CT/MT/PT, which are also Connecticut, Montana and physio: "I'm on CT". */
const ON_CUE = String.raw`(?:here on|I'?m on|we'?re on|I am on)`;
/** Cues that introduce a place: "in Austin", "from Dallas". */
const PLACE_CUE = String.raw`(?:in|from|near)`;
/** A time of day just before an abbreviation: "11am", "3 pm", "14:30". */
const TIME_BEFORE = String.raw`(?:\d\s?[AaPp]\.?[Mm]\.?|\d:\d{2})\s?`;
/** Words that make "Central"/"Pacific" a place, not a zone. */
const NOT_A_ZONE = String.raw`(?! (?:High|School|Ave|Avenue|Park|Station|Market|Ocean|Coast|Europe))`;
/** End of a word, also after punctuation such as the final "." of "D.C.". */
const END = String.raw`(?![A-Za-z0-9_])`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The regex sources for everything that names one zone. `plain` matches are
 * the mention itself; in `tail` matches, group 1 is the mention and it sits
 * at the end of the match (the rest is context that gates it).
 */
function patternFor(z: ZoneWords): { plain: string[]; tail: string[] } {
  const plain: string[] = [];
  const tail: string[] = [];
  if (z.abbr) {
    const A = z.abbr;
    // EST/EDT anywhere; ET only after a time ("10am ET"), with a cue ("in ET") or before "time".
    plain.push(String.raw`\b${A}[SD]T\b`);
    tail.push(String.raw`${TIME_BEFORE}([${A}${A.toLowerCase()}][SsDd]?[Tt])${END}`);
    const cue = "CMP".includes(A) ? ON_CUE : CUE;
    plain.push(String.raw`\b${cue} ${A}[SD]?T\b`);
    plain.push(String.raw`\b${A}[SD]?T (?:[Tt]ime|[Zz]one|TZ)\b`);
    if ("CMP".includes(A)) plain.push(String.raw`\b(?:in|on) ${A}T (?:[Tt]ime|[Zz]one|TZ)\b`);
  }
  if (z.region) {
    const R = `[${z.region[0]}${z.region[0].toLowerCase()}]${z.region.slice(1)}`;
    plain.push(String.raw`\b${R} (?:Standard |Daylight )?[Tt]ime\b`);
    plain.push(String.raw`\b${R} (?:[Tt]ime ?[Zz]one|TZ)\b`);
    plain.push(String.raw`\b${CUE} ${R}\b${NOT_A_ZONE}`);
  }
  for (const w of z.words ?? []) plain.push(String.raw`\b${escape(w)}${END}`);
  for (const c of z.cities ?? []) {
    const C = escape(c);
    tail.push(String.raw`\b${PLACE_CUE} (${C})${END}`);
    tail.push(String.raw`\b(${C})(?= [Tt]ime\b)`);
  }
  return { plain, tail };
}

type Pattern = { re: RegExp; tz: string; tail: boolean };
const PATTERNS: Pattern[] = VOCABULARY.flatMap((z) => {
  const { plain, tail } = patternFor(z);
  const out: Pattern[] = [];
  if (plain.length) out.push({ re: new RegExp(plain.join("|"), "g"), tz: z.tz, tail: false });
  if (tail.length) out.push({ re: new RegExp(tail.join("|"), "g"), tz: z.tz, tail: true });
  return out;
});

/** "UTC+2", "GMT-05:30" */
const FIXED_OFFSET = /\b(?:UTC|GMT)\s?([+-])\s?(\d{1,2})(?::?(\d{2}))?\b/g;

/** Spellings that are abbreviations and so are shown upper-case ("est" → "EST"). */
const ABBREVIATIONS = new Set(
  VOCABULARY.flatMap((z) => [
    ...(z.abbr ? [`${z.abbr}ST`, `${z.abbr}DT`, `${z.abbr}T`] : []),
    ...(z.words ?? []).filter((w) => w === w.toUpperCase() && !/\W/.test(w)),
  ]),
);

/** "I am in Central" → "Central"; abbreviations upper-cased, other names capitalised. */
function displayName(raw: string): string {
  const core = raw.replace(new RegExp(`^${CUE}\\s+`, "i"), "");
  if (ABBREVIATIONS.has(core.toUpperCase())) return core.toUpperCase();
  return core.charAt(0).toUpperCase() + core.slice(1);
}

/* ---------------------------------------------------------------- lookups */

/** Every zone mention in `text`, in order. A thread can quote people in different zones. */
export function detectZones(text: string): ZoneMention[] {
  if (!text) return [];
  const out: ZoneMention[] = [];
  for (const m of text.matchAll(FIXED_OFFSET)) {
    const sign = m[1] === "-" ? -1 : 1;
    out.push({ name: m[0], offsetMin: sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)), index: m.index!, length: m[0].length });
  }
  for (const { re, tz, tail } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      // Tail patterns have one capture group per alternative; the one that matched is the mention, at the end.
      const word = tail ? m.slice(1).find((g) => g !== undefined)! : m[0];
      const index = m.index! + m[0].length - word.length;
      // Keep a parenthesised city with the name: "Central time (Nashville)".
      const city = text.slice(m.index! + m[0].length).match(/^(?:\s*(?:Standard |Daylight )?[Tt]ime)?\s*\(([^)]{2,30})\)/)?.[1];
      const name = displayName(word);
      out.push({ name: city ? `${name} (${city})` : name, tz, index, length: word.length });
    }
  }
  // Longest first at each position, then drop mentions inside another ("UTC" within "UTC+2").
  out.sort((a, b) => a.index - b.index || b.length - a.length);
  return out.filter((z, i) => !out.slice(0, i).some((o) => z.index >= o.index && z.index + z.length <= o.index + o.length));
}

/** The first zone mention, if any (for short texts such as one time expression). */
export function detectZone(text: string): ZoneHint | null {
  return detectZones(text)[0] ?? null;
}

/** How far a zone mention can be from a time and still be taken to describe it. */
const REACH = 400;
/** Each paragraph break or quoted line between them uses up this much reach. */
const PARAGRAPH_COST = 200;

/**
 * The zone mention closest to position `at` in `text`, measured in characters
 * plus a cost per paragraph or quoted line crossed, so "I'm in Central time"
 * describes the times in its own paragraph first. Mentions inside `skip`
 * spans (zones written as part of some other time) don't count.
 */
export function nearestZone(
  zones: ZoneMention[],
  at: number,
  text: string,
  skip: { index: number; length: number }[] = [],
): ZoneHint | null {
  let best: ZoneMention | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    if (skip.some((s) => z.index >= s.index && z.index < s.index + s.length)) continue;
    const [from, to] = z.index >= at ? [at, z.index] : [z.index + z.length, at];
    const breaks = (text.slice(from, to).match(/\n\s*\n|\n>/g) ?? []).length;
    const dist = to - from + breaks * PARAGRAPH_COST;
    if (dist <= REACH && dist < bestDist) {
      best = z;
      bestDist = dist;
    }
  }
  return best;
}

/** Minutes east of UTC that a hint means at `date`. */
export function hintOffset(hint: ZoneHint, date: Date): number {
  return "tz" in hint ? tzOffsetMinutes(date, hint.tz) : hint.offsetMin;
}
