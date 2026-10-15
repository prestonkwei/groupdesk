"use client";

/**
 * The popover behind a date chip: the parsed time and which zone it was read
 * in, the agent's availability, free-slot suggestions, add-to-calendar, and
 * replies to the requester (confirmation with invite, or a time check).
 */
import { useEffect, useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarCheck, CalendarPlus, CalendarSearch, CalendarX, ExternalLink, Globe, Loader2, Mail, Send } from "lucide-react";
import {
  addToCalendar,
  availability,
  eventDescription,
  sendTimeEmail,
  suggestTimes,
  timeEmailDraft,
  type Availability,
  type TimeEmailKind,
} from "@/lib/actions/calendar";
import {
  describeMatch,
  googleCalendarLink,
  localDay,
  nextDay,
  offsetLabel,
  shiftMatch,
  tzOffsetMinutes,
  windowFor,
  zoneLabel,
  type DateMatch,
  type Slot,
} from "@/lib/dates";
import { TIME_ZONE, cn } from "@/lib/utils";
import type { DateContext } from "./date-chips";

/** What gets booked, as the calendar actions take it: instants, or YYYY-MM-DD with an exclusive end for all-day. */
export type Booking = { start: string; end: string; allDay: boolean };

/** The picked slot if there is one, else the mentioned time (an hour for a bare time, the whole day for a bare date). */
export function bookingRange(match: Pick<DateMatch, "start" | "end" | "allDay">, chosen: Slot | null): Booking {
  if (chosen) return { start: chosen.start, end: chosen.end, allDay: false };
  if (match.allDay) {
    const day = localDay(match.start);
    return { start: day, end: nextDay(day), allDay: true };
  }
  const w = windowFor(match);
  return { start: w.start, end: w.end, allDay: false };
}

const FAILED = "That didn't work. Check your connection and try again.";

export function DatePopoverContent({
  match: original,
  context,
  onEnter,
  onLeave,
}: {
  match: DateMatch;
  context: DateContext;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [title, setTitle] = useState(context.subject || "Event");
  // Which zone a bare time ("2pm") is read in. The school zone unless the
  // text named one; when the sender's clock (Date header, at send time)
  // disagrees with the school's clock at that moment, offer it.
  const schoolOffsetAtSend = tzOffsetMinutes(new Date(context.sentAt));
  const senderOffset = context.sentOffsetMin;
  const zoneAmbiguous =
    !original.allDay && !original.tzCertain && senderOffset !== null && senderOffset !== schoolOffsetAtSend;
  const [senderZone, setSenderZone] = useState(false);
  const match = senderZone && zoneAmbiguous ? shiftMatch(original, senderOffset) : original;
  const [result, setResult] = useState<{ ok?: string; error?: string; link?: string } | null>(null);
  const [adding, startAdd] = useTransition();
  // "Suggest a time": free slots of the same length, and the one picked instead.
  const [suggested, setSuggested] = useState<{ slots: Slot[] } | { error: string } | "loading" | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const win = windowFor(match);
  const key = `${win.start}/${win.end}`;
  const durationMin = match.allDay ? 60 : Math.round((new Date(win.end).getTime() - new Date(win.start).getTime()) / 60_000);
  /** What the buttons book. */
  const booking = bookingRange(match, chosen);
  // Keyed by the window so a stale answer for another date reads as "loading".
  const [loaded, setLoaded] = useState<{ key: string; avail: Availability } | null>(null);
  const avail: Availability | "loading" = loaded?.key === key ? loaded.avail : "loading";

  useEffect(() => {
    let cancelled = false;
    availability(win.start, win.end)
      .then((a) => ({ key, avail: a }))
      .catch(() => ({ key, avail: { connected: true, error: "Couldn't check your calendar." } as Availability }))
      .then((l) => {
        if (!cancelled) setLoaded(l);
      });
    return () => {
      cancelled = true;
    };
  }, [key, win.start, win.end]);

  // The event description: ticket link, the quoted sentence, and a digest of
  // later messages (flagging reschedules). Built server-side; the link gets a
  // shortened copy so the URL stays a sane length.
  const [details, setDetails] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    eventDescription({
      ticketId: context.ticketId,
      messageId: context.messageId,
      matchText: match.text,
      matchStart: match.start,
    })
      .then((r) => {
        if (!cancelled && "description" in r) setDetails(r.description);
      })
      // Without it the event is simply created without the extra context.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [context.ticketId, context.messageId, match.text, match.start]);

  const connectHref = `/api/calendar/connect?next=${encodeURIComponent(
    typeof window === "undefined" ? "/tickets" : window.location.pathname,
  )}`;

  function add() {
    setResult(null);
    startAdd(async () => {
      try {
        setResult(await addToCalendar({ title, description: details, ...booking }));
      } catch {
        setResult({ error: FAILED });
      }
    });
  }

  async function suggest() {
    setSuggested("loading");
    try {
      setSuggested(await suggestTimes(win.start, durationMin));
    } catch {
      setSuggested({ error: FAILED });
    }
  }

  return (
    <Popover.Portal>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="z-50 max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm shadow-lg"
      >
        <p className="font-medium">{describeMatch(match)}</p>
        <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]" title={match.text}>
          “{match.text}”
        </p>
        {!match.allDay && (
          <ZoneLine
            match={original}
            zoneAmbiguous={zoneAmbiguous}
            senderZone={senderZone}
            senderOffset={senderOffset}
            senderName={context.fromName}
            onToggle={() => {
              setSenderZone((z) => !z);
              // Suggestions and a picked slot were for the other reading.
              setSuggested(null);
              setChosen(null);
              setResult(null);
            }}
          />
        )}

        <div className="mt-2 rounded-md bg-[var(--muted)] px-2 py-1.5 text-xs">
          <AvailabilityLine avail={avail} connectHref={connectHref} />
          {avail !== "loading" && avail.connected && (
            <div className="mt-1.5">
              {suggested === null && (
                <button
                  type="button"
                  onClick={suggest}
                  className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                >
                  <CalendarSearch className="size-3.5" />
                  Suggest a time
                </button>
              )}
              {suggested === "loading" && (
                <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
                  <Loader2 className="size-3.5 animate-spin" /> Looking for free slots…
                </span>
              )}
              {suggested !== null && suggested !== "loading" && "error" in suggested && (
                <span className="text-[var(--destructive)]">{suggested.error}</span>
              )}
              {suggested !== null && suggested !== "loading" && "slots" in suggested && (
                <SlotPicker
                  slots={suggested.slots}
                  chosen={chosen}
                  durationMin={durationMin}
                  onPick={(s) => {
                    setChosen(s);
                    setResult(null);
                  }}
                />
              )}
            </div>
          )}
        </div>

        <label className="mt-3 block text-xs text-[var(--muted-foreground)]">
          Event title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-[var(--input)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {avail !== "loading" && avail.connected && (
            <button
              type="button"
              onClick={add}
              disabled={adding || !title.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--primary)] px-2.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {adding ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarPlus className="size-3.5" />}
              Add to my calendar
            </button>
          )}
          <a
            href={googleCalendarLink({
              title,
              // The link wants an instant even for all-day (it reads the local day from it).
              start: booking.allDay ? win.start : booking.start,
              end: booking.allDay ? win.end : booking.end,
              allDay: booking.allDay,
              details: details?.slice(0, 1500),
            })}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs hover:bg-[var(--accent)]"
          >
            <ExternalLink className="size-3.5" />
            Open in Google Calendar
          </a>
        </div>

        <RequesterEmail
          ticketId={context.ticketId}
          title={title}
          booking={booking}
          offsetMin={match.offsetMin}
          ambiguous={zoneAmbiguous}
        />

        {result?.ok && (
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
            {result.ok}
            {result.link && (
              <>
                {" · "}
                <a href={result.link} target="_blank" rel="noreferrer" className="underline">
                  open
                </a>
              </>
            )}
          </p>
        )}
        {result?.error && <p className="mt-2 text-xs text-[var(--destructive)]">{result.error}</p>}
      </Popover.Content>
    </Popover.Portal>
  );
}

/** Which zone the time was read in, and a warning when the sender's clock says otherwise. */
function ZoneLine({
  match,
  zoneAmbiguous,
  senderZone,
  senderOffset,
  senderName,
  onToggle,
}: {
  match: DateMatch;
  zoneAmbiguous: boolean;
  senderZone: boolean;
  senderOffset: number | null;
  senderName: string | null;
  onToggle: () => void;
}) {
  const school = `${zoneLabel(match.start)} (${offsetLabel(tzOffsetMinutes(new Date(match.start)))})`;
  if (match.tzCertain) {
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
        <Globe className="size-3" />
        {match.tzSource === "message"
          ? `Zone named in the email: ${match.zoneName} (${offsetLabel(match.offsetMin)})`
          : `Zone given with the time: ${offsetLabel(match.offsetMin)}`}
      </p>
    );
  }
  // `senderOffset === null` can't happen when zoneAmbiguous; it narrows the type for shiftMatch below.
  if (!zoneAmbiguous || senderOffset === null) {
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
        <Globe className="size-3" /> No zone in the email; assuming {school}
      </p>
    );
  }
  const shifted = shiftMatch(match, senderOffset);
  return (
    <div className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="inline-flex items-center gap-1 font-medium">
        <Globe className="size-3" /> Time zone unclear
      </p>
      <p className="mt-0.5">
        No zone in the text, and {senderName ?? "the sender"}&apos;s email was sent from {offsetLabel(senderOffset)},
        not {school}.
      </p>
      <div className="mt-1 flex flex-col gap-0.5" role="radiogroup" aria-label="Read the time in">
        {(
          [
            [false, `Ours: ${describeMatch(match)}`],
            [true, `Theirs: ${describeMatch(shifted)}`],
          ] as const
        ).map(([theirs, label]) => (
          <button
            key={String(theirs)}
            type="button"
            role="radio"
            aria-checked={senderZone === theirs}
            onClick={() => senderZone !== theirs && onToggle()}
            className={cn(
              "rounded border px-1.5 py-0.5 text-left",
              senderZone === theirs
                ? "border-amber-500 bg-white font-medium dark:bg-amber-900/60"
                : "border-transparent hover:bg-amber-100 dark:hover:bg-amber-900/40",
            )}
            title={label}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 opacity-80">Not sure? Ask them below; the email spells out the zone.</p>
    </div>
  );
}

/**
 * Reply to the requester about the time: a confirmation with an .ics invite
 * attached, or a question asking them to confirm time and zone. The draft
 * is editable before it goes.
 */
function RequesterEmail({
  ticketId,
  title,
  booking,
  offsetMin,
  ambiguous,
}: {
  ticketId: string;
  title: string;
  booking: Booking;
  offsetMin: number;
  ambiguous: boolean;
}) {
  const [kind, setKind] = useState<TimeEmailKind | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const payload = (k: TimeEmailKind) => ({ ticketId, kind: k, title, ...booking, offsetMin });

  function open(k: TimeEmailKind) {
    setKind(k);
    setStatus(null);
    setText("");
    start(async () => {
      try {
        const r = await timeEmailDraft(payload(k));
        setText("text" in r ? r.text : "");
        if ("error" in r) setStatus({ error: r.error });
      } catch {
        setStatus({ error: FAILED });
      }
    });
  }

  function send() {
    if (!kind) return;
    start(async () => {
      try {
        const r = await sendTimeEmail({ ...payload(kind), text });
        setStatus(r);
        if (r.ok) setKind(null);
      } catch {
        setStatus({ error: FAILED });
      }
    });
  }

  if (status?.ok) return <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{status.ok}</p>;

  if (!kind) {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => open("confirm")}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs hover:bg-[var(--accent)]"
        >
          <Mail className="size-3.5" /> Email confirmation + invite
        </button>
        <button
          type="button"
          onClick={() => open("ask")}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-[var(--accent)]",
            ambiguous ? "border-amber-400 text-amber-900 dark:text-amber-200" : "border-[var(--border)]",
          )}
        >
          <Mail className="size-3.5" /> Ask them to confirm the time
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-[var(--muted-foreground)]">
        {kind === "confirm" ? "Reply to the requester, with invite.ics attached:" : "Reply to the requester:"}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        disabled={pending && !text}
        className="mt-1 w-full rounded-md border border-[var(--input)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={send}
          disabled={pending || !text.trim()}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--primary)] px-2 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send
        </button>
        <button type="button" onClick={() => setKind(null)} className="text-xs text-[var(--muted-foreground)] hover:underline">
          Cancel
        </button>
        {status?.error && <span className="text-xs text-[var(--destructive)]">{status.error}</span>}
      </div>
    </div>
  );
}

/** Free slots to book instead of the mentioned time; "mentioned" switches back. */
function SlotPicker({
  slots,
  chosen,
  durationMin,
  onPick,
}: {
  slots: Slot[];
  chosen: Slot | null;
  durationMin: number;
  onPick: (s: Slot | null) => void;
}) {
  if (!slots.length) {
    return <span className="text-[var(--muted-foreground)]">No free {durationMin}-minute slot in school hours over the next two weeks.</span>;
  }
  const fmt = (s: Slot) => describeMatch({ start: s.start, end: s.end, allDay: false });
  return (
    <div role="radiogroup" aria-label="Suggested times">
      <p className="text-[var(--muted-foreground)]">Free for {durationMin} min:</p>
      <ul className="mt-0.5 space-y-0.5">
        {slots.map((s) => {
          const on = chosen?.start === s.start;
          return (
            <li key={s.start}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(on ? null : s)}
                className={cn(
                  "w-full rounded px-1.5 py-0.5 text-left hover:bg-[var(--accent)]",
                  on && "bg-[var(--accent)] font-medium text-[var(--primary)]",
                )}
              >
                {fmt(s)}
              </button>
            </li>
          );
        })}
      </ul>
      {chosen && (
        <p className="mt-1 text-[var(--muted-foreground)]">
          Booking the slot above instead ·{" "}
          <button type="button" onClick={() => onPick(null)} className="underline">
            use the mentioned time
          </button>
        </p>
      )}
    </div>
  );
}

function AvailabilityLine({ avail, connectHref }: { avail: Availability | "loading"; connectHref: string }) {
  if (avail === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
        <Loader2 className="size-3.5 animate-spin" /> Checking your calendar…
      </span>
    );
  }
  if (!avail.connected) {
    return (
      <span>
        <a href={connectHref} className="font-medium text-[var(--primary)] underline">
          Connect Google Calendar
        </a>{" "}
        to see if you&apos;re free.
      </span>
    );
  }
  if ("error" in avail) return <span className="text-[var(--destructive)]">{avail.error}</span>;
  if (!avail.busy.length) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
        <CalendarCheck className="size-3.5" /> You&apos;re free
      </span>
    );
  }
  const time = (iso: string, allDay: boolean) =>
    allDay
      ? "all day"
      : new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
  return (
    <div>
      <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
        <CalendarX className="size-3.5" /> Busy
      </span>
      <ul className="mt-1 space-y-0.5">
        {avail.busy.slice(0, 4).map((b, i) => (
          <li key={i} className="truncate">
            <span className="tabular-nums text-[var(--muted-foreground)]">
              {b.allDay ? "all day" : `${time(b.start, false)}–${time(b.end, false)}`}
            </span>{" "}
            {b.title ?? "(busy)"}
          </li>
        ))}
        {avail.busy.length > 4 && (
          <li className="text-[var(--muted-foreground)]">+{avail.busy.length - 4} more</li>
        )}
      </ul>
    </div>
  );
}
