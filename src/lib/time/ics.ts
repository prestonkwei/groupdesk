/** A minimal iCalendar invite (RFC 5545, METHOD:REQUEST) that mail clients show as an event. No dependencies beyond ./tz. */
import { compactUtc } from "./tz";

export type InviteInput = {
  uid: string;
  title: string;
  description: string;
  /** ISO instants, or "YYYY-MM-DD" when allDay (end exclusive). */
  start: string;
  end: string;
  allDay: boolean;
  organizer: { name: string; email: string };
  attendee: { name: string | null; email: string };
  /** Shown as the generator; "-//Org//Product//EN". */
  prodId?: string;
  /** DTSTAMP; defaults to the current time. */
  now?: Date;
  /** Revision number for updates to the same UID; defaults to 0. */
  sequence?: number;
};

export function icsInvite(input: InviteInput): string {
  const when = input.allDay
    ? [`DTSTART;VALUE=DATE:${input.start.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${input.end.replace(/-/g, "")}`]
    : [`DTSTART:${compactUtc(input.start)}`, `DTEND:${compactUtc(input.end)}`];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${input.prodId ?? "-//ics-invite//EN"}`,
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${compactUtc((input.now ?? new Date()).toISOString())}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    ...when,
    `SUMMARY:${escapeText(input.title)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    `ORGANIZER;CN=${paramValue(input.organizer.name)}:mailto:${input.organizer.email}`,
    `ATTENDEE;CN=${paramValue(input.attendee.name ?? input.attendee.email)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${input.attendee.email}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Backslash, semicolon, comma and newline are special in text values. */
function escapeText(t: string): string {
  return t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Parameter values can't be escaped; they are double-quoted, with quotes and line breaks removed. */
function paramValue(v: string): string {
  return `"${v.replace(/["\r\n]/g, "")}"`;
}

const encoder = new TextEncoder();

/** Lines longer than 75 octets continue on the next line after a space; never splits a character. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let budget = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > budget) {
      out.push(cur);
      cur = "";
      bytes = 0;
      budget = 74; // the leading space of a continuation line counts
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
