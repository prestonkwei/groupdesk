/**
 * Checks an iCalendar invite with ical.js (Mozilla's strict RFC 5545 parser,
 * the one Thunderbird uses) before it is sent or asserted on in tests. Needs
 * ical.js; nothing else in the toolkit imports this file.
 */
import ICAL from "ical.js";

export type InviteCheck =
  | { ok: true; summary: string; description: string; uid: string; attendees: string[] }
  | { ok: false; error: string };

const REQUIRED = ["uid", "dtstamp", "dtstart", "dtend", "summary", "organizer", "attendee"] as const;

/** Parses `ics` and confirms it carries everything a METHOD:REQUEST invite needs. */
export function checkInvite(ics: string): InviteCheck {
  let root: ICAL.Component;
  try {
    root = ICAL.Component.fromString(ics);
  } catch (err) {
    return { ok: false, error: `Invalid iCalendar: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (root.name !== "vcalendar") return { ok: false, error: `Expected VCALENDAR, got ${root.name.toUpperCase()}` };
  if (root.getFirstPropertyValue("method") !== "REQUEST") return { ok: false, error: "METHOD must be REQUEST" };
  const event = root.getFirstSubcomponent("vevent");
  if (!event) return { ok: false, error: "No VEVENT" };
  for (const name of REQUIRED) {
    if (!event.getFirstProperty(name)) return { ok: false, error: `VEVENT is missing ${name.toUpperCase()}` };
  }
  const attendees = event.getAllProperties("attendee").map((p) => String(p.getFirstValue()));
  return {
    ok: true,
    uid: String(event.getFirstPropertyValue("uid")),
    summary: String(event.getFirstPropertyValue("summary")),
    description: String(event.getFirstPropertyValue("description") ?? ""),
    attendees,
  };
}
