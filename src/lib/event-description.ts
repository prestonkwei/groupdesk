/**
 * The text that goes into a calendar event booked from a ticket: a link back,
 * where the date was mentioned, and a digest of every message since, with the
 * ones that mention other dates or sound like a reschedule flagged. No I/O:
 * the server action feeds it rows. Times are shown in `tz` (the school zone
 * unless the caller says otherwise).
 */
import { describeMatch, detectDates, localDay } from "./dates";
import { TIME_ZONE } from "./utils";

export type DescribedMessage = {
  sentAt: Date | string;
  direction: "inbound" | "outbound" | "note";
  fromName: string | null;
  fromEmail: string;
  /** Agent's name for notes and portal replies. */
  authorName: string | null;
  /** New text only, no quoted history. */
  text: string;
};

export type DescriptionInput = {
  ticket: { number: number; subject: string; requesterName: string | null; requesterEmail: string };
  url: string;
  /** The message the date came from, and the text the chip matched in it. */
  source: DescribedMessage;
  matchText: string;
  matchStart: string;
  /** Messages after `source`, oldest first. */
  later: DescribedMessage[];
  /** IANA zone for displayed times and same-day comparisons. Defaults to TIME_ZONE. */
  tz?: string;
};

/** Wording that usually means the time is moving. */
const RESCHEDULE =
  /\b(push(ed|ing)? back|mov(e|ed|ing) (it|this|the (meeting|call|time))|reschedul\w*|postpon\w*|delay(ed)?|can'?t make|won'?t work|doesn'?t work|instead of|a different (time|day|date)|(later|earlier) (in the day|that day|than)|cancel(l?ed)? (the|our|it)|running late)\b/i;

/** Two readings of "the same time" closer than this are the same. */
const SAME_TOLERANCE_MS = 15 * 60_000;

const MAX_SHOWN = 8;
const SNIPPET = 220;

export function buildEventDescription(input: DescriptionInput): string {
  const { ticket, source } = input;
  const tz = input.tz ?? TIME_ZONE;
  const notes = input.later.filter((m) => m.direction === "note").length;
  const later = input.later.filter((m) => m.direction !== "note");
  const requester = ticket.requesterName ? `${ticket.requesterName} <${ticket.requesterEmail}>` : ticket.requesterEmail;
  const quote = sentenceAround(source.text, input.matchText) || input.matchText;

  const lines = [
    `Ticket #${ticket.number}: ${ticket.subject}`,
    input.url,
    `Requester: ${requester}`,
    "",
    `Mentioned by ${who(source)} on ${when(source.sentAt, tz)}:`,
    `“${quote}”`,
    "",
  ];

  const skipped = notes ? ` (${notes} internal note${notes === 1 ? "" : "s"} not shown)` : "";
  if (!later.length) {
    lines.push(`No follow-up on the ticket since that email (as of booking)${skipped}.`);
    return lines.join("\n");
  }

  const shown = later.slice(-MAX_SHOWN);
  const n = later.length;
  lines.push(
    `Since then, ${n} message${n === 1 ? "" : "s"} on the ticket${n > shown.length ? ` (last ${shown.length} shown)` : ""}${skipped}:`,
  );
  const wantedMs = Date.parse(input.matchStart);
  const wantedDay = localDay(input.matchStart, tz);
  const wantedText = input.matchText.trim().toLowerCase();

  const flagged: string[] = [];
  for (const m of shown) {
    const otherDates = [
      ...new Set(
        detectDates(m.text, m.sentAt)
          .filter((d) => {
            // The same written phrase is not news, and the same local day and
            // time (within a tolerance) is the same date even if re-read from
            // a different send time or zone.
            if (d.text.trim().toLowerCase() === wantedText) return false;
            const ms = Date.parse(d.start);
            if (Math.abs(ms - wantedMs) <= SAME_TOLERANCE_MS) return false;
            return d.allDay ? localDay(d.start, tz) !== wantedDay : true;
          })
          .map((d) => describeMatch(d, tz)),
      ),
    ];
    const reschedule = RESCHEDULE.test(m.text);
    const flag = reschedule || otherDates.length;
    lines.push(`• ${when(m.sentAt, tz)} — ${who(m)}${flag ? " ⚠" : ""}`);
    lines.push(`  ${m.text.replace(/\s+/g, " ").trim().slice(0, SNIPPET) || "(no text)"}`);
    if (otherDates.length) lines.push(`  Mentions: ${otherDates.slice(0, 4).join("; ")}`);
    if (flag) flagged.push(`${when(m.sentAt, tz)} (${who(m)})`);
  }
  if (flagged.length) lines.push("", `⚠ Possible delay or time change — check: ${flagged.join(", ")}`);
  return lines.join("\n");
}

function who(m: DescribedMessage): string {
  if (m.direction === "note") return `${m.authorName ?? "an agent"} (internal note)`;
  if (m.direction === "outbound") return `${m.authorName ?? "us"} (our reply)`;
  return m.fromName || m.fromEmail;
}

function when(d: Date | string, tz: string): string {
  return new Date(d).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

/** The sentence of `text` containing `needle`, trimmed to something quotable. */
function sentenceAround(text: string, needle: string): string {
  const i = text.indexOf(needle);
  if (i < 0) return "";
  const ends = [". ", "\n", "? ", "! "];
  const from = Math.max(...ends.map((e) => text.lastIndexOf(e, i)));
  const after = ends.map((e) => text.indexOf(e, i + needle.length)).filter((x) => x >= 0);
  const to = after.length ? Math.min(...after) + 1 : text.length;
  return text.slice(from + 1, to).replace(/\s+/g, " ").trim().slice(0, 240);
}
