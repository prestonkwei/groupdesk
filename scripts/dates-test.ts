/*
 * Offline checks for the date detector (src/lib/time): which phrases become
 * chips, which zone a bare time is read in, slot finding, agenda rows and
 * the .ics invite. No database or network — run it after touching lib/time.
 */
import { agendaRows, dayBounds, detectDates, detectZones, findSlots, icsInvite } from "../src/lib/time";
import { checkInvite } from "../src/lib/time/ics-check";

const TZ = "America/Los_Angeles";
const HOURS = { openMin: 8 * 60, closeMin: 16 * 60 };
/** A Tuesday morning, Pacific. */
const SENT = "2026-10-13T16:14:00Z";

const local = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const at = (text: string, sentAt: string) => detectDates(text, { sentAt, tz: TZ })[0];
const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const first = (text: string) => detectDates(text, { sentAt: SENT, tz: TZ })[0];
const sentOn = (sentAt: string, text: string) => detectDates(text, { sentAt, tz: TZ })[0];
const names = (text: string) => detectZones(text).map((z) => z.name);
const bytes = (s: string) => new TextEncoder().encode(s).length;
const invite = (over: Partial<Parameters<typeof icsInvite>[0]> = {}) =>
  icsInvite({
    uid: "u@x", title: "A", description: "d", start: "2026-10-23T21:00:00Z", end: "2026-10-23T22:00:00Z", allDay: false,
    organizer: { name: "Team", email: "help@example.org" }, attendee: { name: null, email: "p@example.org" },
    now: new Date("2026-10-13T16:00:00Z"), ...over,
  });

type Check = [label: string, actual: unknown, expected: unknown];
const checks: Check[] = [
  // What becomes a chip
  ["plain date and time", first("set up on Friday October 23rd at 2pm?")?.text, "Friday October 23rd at 2pm"],
  ["preposition trimmed", first("meet on Monday at 9am").text, "Monday at 9am"],
  ["time range", local(first("Thursday 22 October from 4pm to 5pm").end!), "Thu, Oct 22, 5:00 PM"],
  ["bare time without a day is skipped", detectDates("Does 10:30 work?", { sentAt: SENT, tz: TZ }).length, 0],
  ["'two weeks ago' is skipped", detectDates("I wrote two weeks ago", { sentAt: SENT, tz: TZ }).length, 0],
  ["all-day when no time", first("next Tuesday morning").allDay, true],

  // Zones
  ["bare time assumed in the school zone", local(first("Thursday noon works for me.").start), "Thu, Oct 15, 12:00 PM"],
  ["zone named in the next sentence", local(first("Thursday noon works for me. But I am in Central time (Nashville).").start), "Thu, Oct 15, 10:00 AM"],
  ["…and credited", first("Thursday noon works for me. But I am in Central time (Nashville).").zoneName, "Central (Nashville)"],
  ["PST in October means PDT", local(first("Monday at 11 AM PST").start), "Mon, Oct 19, 11:00 AM"],
  ["lowercase est after a time", local(first("Tuesday at 3pm est").start), "Tue, Oct 13, 12:00 PM"],
  ["CT after a time", local(first("Wednesday 10am CT").start), "Wed, Oct 14, 8:00 AM"],
  ["cue + two letters", local(first("I'm on CT. Wednesday at 10?").start), "Wed, Oct 14, 8:00 AM"],
  ["UTC inline", local(first("Friday at 15:00 UTC").start), "Fri, Oct 16, 8:00 AM"],
  ["bare region with cue", local(first("We're on mountain time: Monday 8am?").start), "Mon, Oct 19, 7:00 AM"],
  ["'Central High' is a place", detectZones("Meeting in the Central High gym Friday at 4pm.").length, 0],
  ["'CT scan' is not a zone", detectZones("the CT scan is Friday at 2pm").length, 0],
  [
    "inline zone of another time doesn't leak",
    local(first("Does Monday at 11 AM PST work?\n\n> Thursday noon works for me. But I am in Central time.").start),
    "Mon, Oct 19, 11:00 AM",
  ],
  [
    "nearest mention wins over an earlier inline one",
    local(detectDates("Does Monday at 11 AM PST work?\n\n> Thursday noon works for me. But I am in Central time.", { sentAt: SENT, tz: TZ })[1].start),
    "Thu, Oct 15, 10:00 AM",
  ],

  // DST: the offset applies on the day meant, not the day the email was sent
  ["November date from an October email is PST", sentOn(SENT, "Thursday November 5 at 2pm")?.start, "2026-11-05T22:00:00.000Z"],
  ["…and its offset", sentOn(SENT, "Thursday November 5 at 2pm")?.offsetMin, -480],
  ["March date from a February email is PDT", sentOn("2027-02-23T17:00:00Z", "Tuesday March 16 at 2pm")?.start, "2027-03-16T21:00:00.000Z"],
  ["…and its offset", sentOn("2027-02-23T17:00:00Z", "Tuesday March 16 at 2pm")?.offsetMin, -420],
  ["named zone uses its offset on that date", sentOn(SENT, "Thursday November 5 at 2pm Eastern time")?.start, "2026-11-05T19:00:00.000Z"],
  ["localInstant at midnight on fall-back day", dayBounds("2026-11-01", TZ).start, "2026-11-01T07:00:00.000Z"],
  ["…and the next midnight", dayBounds("2026-11-01", TZ).end, "2026-11-02T08:00:00.000Z"],
  ["localInstant at midnight on spring-forward day", dayBounds("2026-03-08", TZ).start, "2026-03-08T08:00:00.000Z"],
  ["…and the next midnight", dayBounds("2026-03-08", TZ).end, "2026-03-09T07:00:00.000Z"],

  // Past references stay in the past
  ["'last Friday' is not a chip", detectDates("I wrote last Friday at 2pm", { sentAt: SENT, tz: TZ }).length, 0],
  ["'the Oct 10 incident' is not a chip", detectDates("About the Oct 10 incident", { sentAt: SENT, tz: TZ }).length, 0],
  ["'due 10/12' is not a chip", detectDates("it was due 10/12", { sentAt: SENT, tz: TZ }).length, 0],
  ["Thursday noon from Tuesday is this Thursday", sentOn(SENT, "Thursday noon")?.start, "2026-10-15T19:00:00.000Z"],
  ["Monday from Tuesday is next Monday", local(sentOn(SENT, "Monday at 9am")?.start), "Mon, Oct 19, 9:00 AM"],
  ["next Tuesday morning is a week out", local(first("next Tuesday morning").start).startsWith("Tue, Oct 20"), true],

  // Zone false positives
  ["a greeting is not a city", names("Hi Charlotte, can we meet Friday at 2pm?"), []],
  ["Hi Austin", names("Hi Austin"), []],
  ["a city after 'in'", names("I'm in Austin, Friday works"), ["Austin"]],
  ["a city before 'time'", names("Nashville time is fine"), ["Nashville"]],
  ["12pt is not Pacific", names("use a 12pt font"), []],
  ["10 ct box", names("a 10 ct box"), []],
  ["3 et al.", names("Smith 3 et al. wrote"), []],
  ["time then abbreviation still works", names("Friday at 3pm pt"), ["PT"]],
  ["'born in CT' is Connecticut", names("she was born in CT"), []],
  ["'in MT' is Montana", names("a trip in MT"), []],
  ["'in CT time' is a zone", names("meet in CT time"), ["CT time"]],
  ["Rome stays Rome", names("while in Rome"), ["Rome"]],
  ["Oslo stays Oslo", names("Oslo time please"), ["Oslo"]],
  ["abbreviations are upper-cased", names("Friday 3pm est"), ["EST"]],
  ["Washington, D.C.", names("I live in Washington, D.C. now"), ["Washington, D.C."]],
  ["UTC+2 is one mention", detectZones("Friday 10:00 UTC+2").length, 1],

  // Said on a Thursday at 9am Pacific (2026-10-15T16:00Z)
  ["'this Thursday morning' on Thursday morning is today", localDate(at("this Thursday morning", "2026-10-15T16:00:00Z").start), "Thu, Oct 15"],
  ["'Thursday afternoon' on Thursday morning is today", localDate(at("Thursday afternoon", "2026-10-15T16:00:00Z").start), "Thu, Oct 15"],
  ["'this Thursday' on Thursday evening is still today", localDate(at("this Thursday", "2026-10-16T02:00:00Z").start), "Thu, Oct 15"],
  ["'Thursday at 8am' on Thursday at 9am is today", localDate(at("Thursday at 8am", "2026-10-15T16:00:00Z").start), "Thu, Oct 15"],
  ["'Thursday at 7am' on Thursday at 9am is next week", localDate(at("Thursday at 7am", "2026-10-15T16:00:00Z").start), "Thu, Oct 22"],

  // Scheduling
  [
    "slots skip a busy Friday afternoon and the weekend",
    findSlots(
      [
        { start: "2026-10-23T21:00:00Z", end: "2026-10-23T22:00:00Z" },
        { start: "2026-10-23T22:30:00Z", end: "2026-10-23T23:00:00Z" },
      ],
      { from: "2026-10-23T21:00:00Z", durationMin: 60, tz: TZ, hours: HOURS },
    ).map((s) => local(s.start)),
    ["Mon, Oct 26, 8:00 AM", "Mon, Oct 26, 8:30 AM", "Mon, Oct 26, 9:00 AM"],
  ],
  [
    "agenda rows clip and fill",
    agendaRows(
      [
        { start: "2026-10-23T17:00:00Z", end: "2026-10-23T18:00:00Z", title: "Staff meeting", allDay: false },
        { start: "2026-10-23T12:00:00Z", end: "2026-10-23T15:30:00Z", title: "Early", allDay: false },
        { start: "2026-10-23", end: "2026-10-24", title: "Field trip", allDay: true },
      ],
      "2026-10-23",
      TZ,
      HOURS,
    ).map((r) => (r.free ? "free" : r.title)),
    ["Early", "free", "Staff meeting", "free"],
  ],

  // ICS
  [
    "ics has the essentials",
    icsInvite({
      uid: "u@x", title: "A; b", description: "d", start: "2026-10-23T21:00:00Z", end: "2026-10-23T22:00:00Z", allDay: false,
      organizer: { name: "Team", email: "help@example.org" }, attendee: { name: null, email: "p@example.org" },
    })
      .replace(/\r\n /g, "") // unfold
      .split("\r\n")
      .filter((l) => /^(METHOD|DTSTART|SUMMARY|ATTENDEE)/.test(l)),
    ["METHOD:REQUEST", "DTSTART:20261023T210000Z", String.raw`SUMMARY:A\; b`, String.raw`ATTENDEE;CN="p@example.org";ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:p@example.org`],
  ],
  [
    "ics folds emoji titles by octets without splitting characters",
    (() => {
      const lines = invite({ title: "Party 🎉".repeat(20) }).split("\r\n").filter(Boolean);
      const unfolded = invite({ title: "Party 🎉".repeat(20) }).replace(/\r\n /g, "");
      return [lines.every((l) => bytes(l) <= 75), unfolded.includes("Party 🎉".repeat(20)), !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(unfolded)];
    })(),
    [true, true, true],
  ],
  ["ics quotes CN with a comma", invite({ attendee: { name: 'Doe, John: "x"', email: "p@example.org" } }).includes('CN="Doe, John: x";'), true],
  ["ics DTSTAMP uses now", invite().includes("DTSTAMP:20261013T160000Z"), true],
  ["ics SEQUENCE", [invite().includes("SEQUENCE:0"), invite({ sequence: 2 }).includes("SEQUENCE:2")], [true, true]],
];


// ical.js round trip: the strict parser accepts the file and reads back what went in.
{
  const title = "Projector; setup, \"gym\" 🎉";
  const description = "Line one\nLine two, with a comma; and a semicolon";
  const ics = icsInvite({
    uid: "ticket-1-1@example.org", title, description,
    start: "2026-10-23T21:00:00Z", end: "2026-10-23T22:00:00Z", allDay: false,
    organizer: { name: "Tech Team", email: "help@example.org" },
    attendee: { name: "Doe, John", email: "p@example.org" },
  });
  const check = checkInvite(ics);
  checks.push(["ical.js accepts the invite", check.ok ? "ok" : check, "ok"]);
  if (check.ok) {
    checks.push(["summary round-trips through ical.js", check.summary, title]);
    checks.push(["description round-trips through ical.js", check.description, description]);
    checks.push(["attendee round-trips through ical.js", check.attendees, ["mailto:p@example.org"]]);
  }
  checks.push(["ical.js rejects a truncated file", checkInvite(ics.slice(0, 120)).ok, false]);
  checks.push(["missing METHOD is caught", checkInvite(ics.replace("METHOD:REQUEST\r\n", "")).ok, false]);
}

let failed = 0;
for (const [label, actual, expected] of checks) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       got ${JSON.stringify(actual)}\n       want ${JSON.stringify(expected)}`}`);
}
console.log(failed ? `\n${failed} failed` : `\nall ${checks.length} passed`);
process.exit(failed ? 1 : 0);
