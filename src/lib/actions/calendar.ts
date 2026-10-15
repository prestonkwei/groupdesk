"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { agentCalendars, agents, messages, tickets } from "@/db/schema";
import { env } from "@/lib/env";
import { messageText } from "@/lib/message-text";
import { requireAgent } from "@/lib/auth";
import { busyBetween, createEvent, suggestSlots, type BusySlot } from "@/lib/calendar";
import { dayBounds, describeMatch, icsInvite, offsetLabel, zoneLabel, type Slot } from "@/lib/dates";
import { checkInvite } from "@/lib/time/ics-check";
import { buildEventDescription, type DescribedMessage } from "@/lib/event-description";
import { decryptSecret } from "@/lib/crypto";
import { oauthClient } from "@/lib/gmail/client";
import { sendReply } from "@/lib/gmail/send";
import { TEAM_NAME, TIME_ZONE } from "@/lib/utils";
import { DATE_DETECTOR } from "@/lib/features";
import type { ActionState } from "./tickets";

/** Every action here needs the feature on and a signed-in agent. */
async function requireFeature() {
  if (!DATE_DETECTOR) throw new Error("The date detector is off (NEXT_PUBLIC_DATE_DETECTOR).");
  return requireAgent();
}

export type Availability =
  | { connected: false }
  | { connected: true; busy: BusySlot[] }
  | { connected: true; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Epoch ms of an ISO instant (`...Z`), or null if malformed or not a real date. */
function instantMs(s: string): number | null {
  if (!ISO.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s.slice(0, 10) ? null : ms;
}

/** Epoch ms of midnight UTC of a YYYY-MM-DD, or null if it isn't a real date. */
function dayMs(s: string): number | null {
  if (!DAY.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s ? null : ms;
}

/** Both ends valid (instants, or days when allDay) and start strictly before end. */
function validRange(start: string, end: string, allDay: boolean): boolean {
  const [a, b] = allDay ? [dayMs(start), dayMs(end)] : [instantMs(start), instantMs(end)];
  return a !== null && b !== null && a < b;
}

async function lookup(start: string, end: string): Promise<Availability> {
  const { agent } = await requireFeature();
  try {
    const busy = await busyBetween(agent.id, start, end);
    if (!busy) return { connected: false };
    return { connected: true, busy };
  } catch (err) {
    return { connected: true, error: err instanceof Error ? err.message : "Calendar lookup failed" };
  }
}

/** What's on my calendar between two instants (a date mention in an email). */
export async function availability(start: string, end: string): Promise<Availability> {
  await requireFeature();
  if (!validRange(start, end, false)) return { connected: true, error: "Bad time range" };
  return lookup(start, end);
}

/** Free slots of the same length, from the mentioned time onwards (or from now, if that's later). */
export async function suggestTimes(
  from: string,
  durationMin: number,
): Promise<{ slots: Slot[] } | { error: string }> {
  const { agent } = await requireFeature();
  const fromMs = instantMs(from);
  if (fromMs === null || !Number.isFinite(durationMin)) return { error: "Bad time" };
  const dur = Math.min(Math.max(Math.round(durationMin), 15), 8 * 60);
  const start = new Date(Math.max(fromMs, Date.now())).toISOString();
  try {
    const slots = await suggestSlots(agent.id, start, dur);
    if (!slots) return { error: "Connect your calendar first" };
    return { slots };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Calendar lookup failed" };
  }
}

export type Agenda = Availability;

/** Everything on my calendar on a local day (YYYY-MM-DD), for the sidebar peek. */
export async function agenda(day: string): Promise<Agenda> {
  await requireFeature();
  if (dayMs(day) === null) return { connected: true, error: "Bad day" };
  let bounds: { start: string; end: string };
  try {
    bounds = dayBounds(day);
  } catch {
    return { connected: true, error: "Bad day" };
  }
  return lookup(bounds.start, bounds.end);
}

/** The calendar event's description; see lib/event-description.ts. */
export async function eventDescription(input: {
  ticketId: string;
  messageId: string;
  /** The text the chip matched, to quote its sentence. */
  matchText: string;
  /** The parsed date, so other dates in follow-ups can be called out as different. */
  matchStart: string;
}): Promise<{ description: string } | { error: string }> {
  await requireFeature();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, input.ticketId)).limit(1);
  if (!ticket) return { error: "Ticket not found" };
  const [source] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.ticketId, ticket.id)))
    .limit(1);
  if (!source) return { error: "Message not found" };
  const later = await db
    .select({ m: messages, authorName: agents.name })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.authorAgentId))
    .where(and(eq(messages.ticketId, ticket.id), gt(messages.sentAt, source.sentAt)))
    .orderBy(asc(messages.sentAt));

  const describe = (m: typeof source, authorName: string | null): DescribedMessage => ({
    sentAt: m.sentAt,
    direction: m.direction,
    fromName: m.fromName,
    fromEmail: m.fromEmail,
    authorName,
    text: messageText(m),
  });
  return {
    description: buildEventDescription({
      ticket,
      url: `${env.appUrl}/tickets/${ticket.number}`,
      source: describe(source, null),
      matchText: input.matchText,
      matchStart: input.matchStart,
      later: later.map((r) => describe(r.m, r.authorName)),
    }).slice(0, 8000),
  };
}

export async function addToCalendar(input: {
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
}): Promise<ActionState & { link?: string }> {
  const { agent } = await requireFeature();
  const title = input.title.trim().slice(0, 200);
  if (!title) return { error: "Give the event a title" };
  if (!validRange(input.start, input.end, input.allDay)) return { error: "Bad time range" };
  try {
    const r = await createEvent(agent.id, {
      title,
      description: input.description?.slice(0, 8000),
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      tz: TIME_ZONE,
    });
    if (!r) return { error: "Connect your calendar first" };
    return { ok: "Added to your calendar", link: r.htmlLink ?? undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add the event" };
  }
}

export async function disconnectCalendar(): Promise<ActionState> {
  const { agent } = await requireFeature();
  const [row] = await db.select().from(agentCalendars).where(eq(agentCalendars.agentId, agent.id)).limit(1);
  if (row) {
    try {
      await oauthClient().revokeToken(decryptSecret(row.refreshTokenEnc));
    } catch {
      /* already revoked, or Google unreachable: still disconnect locally */
    }
  }
  await db.delete(agentCalendars).where(eq(agentCalendars.agentId, agent.id));
  revalidatePath("/", "layout");
  return { ok: "Calendar disconnected" };
}

export type TimeEmailKind = "confirm" | "ask";

type TimeEmailInput = {
  ticketId: string;
  kind: TimeEmailKind;
  title: string;
  /** ISO instants, or YYYY-MM-DD when allDay. */
  start: string;
  end: string;
  allDay: boolean;
  /** Offset the time was read in (minutes east of UTC), to spell out in the email. */
  offsetMin: number;
};

function timeSentence(input: TimeEmailInput) {
  const zone = input.allDay ? "" : ` ${zoneLabel(input.start)} (${offsetLabel(input.offsetMin)})`;
  const when = input.allDay
    ? describeMatch({ start: `${input.start}T12:00:00Z`, end: null, allDay: true }, "UTC")
    : describeMatch({ start: input.start, end: input.end, allDay: false });
  return `${when}${zone}`;
}

/** The suggested wording, for the agent to edit before sending. */
export async function timeEmailDraft(input: TimeEmailInput): Promise<{ text: string } | { error: string }> {
  await requireFeature();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, input.ticketId)).limit(1);
  if (!ticket) return { error: "Ticket not found" };
  const first = (ticket.requesterName ?? "").split(/\s+/)[0] || "there";
  const when = timeSentence(input);
  const text =
    input.kind === "confirm"
      ? `Hi ${first},\n\nConfirming ${input.title}: ${when}. A calendar invite is attached.\n\nIf that isn't the time you meant, just reply and we'll adjust.`
      : `Hi ${first},\n\nQuick check on timing: we read your email as ${when}. Is that right, or did you mean a different time or time zone? We're in ${zoneLabel(input.allDay ? new Date().toISOString() : input.start, "long")}.`;
  return { text };
}

/**
 * Email the requester about the time, as a normal reply on the ticket (from
 * the group, threaded). "confirm" attaches an .ics invite with the group as
 * organizer; "ask" just asks them to confirm the time and zone.
 */
export async function sendTimeEmail(input: TimeEmailInput & { text: string }): Promise<ActionState> {
  const { agent } = await requireFeature();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, input.ticketId)).limit(1);
  if (!ticket) return { error: "Ticket not found" };
  if (input.kind !== "confirm" && input.kind !== "ask") return { error: "Unknown email type" };
  if (!Number.isInteger(input.offsetMin) || Math.abs(input.offsetMin) > 840) return { error: "Bad time zone offset" };
  if (typeof input.title !== "string" || input.title.length > 200) return { error: "Title is too long" };
  if (typeof input.text !== "string") return { error: "Write something first" };
  const text = input.text.trim();
  if (!text) return { error: "Write something first" };
  if (text.length > 5000) return { error: "The message is too long (5000 characters at most)" };
  if (!validRange(input.start, input.end, input.allDay)) return { error: "Bad time range" };

  let attachments: { filename: string; contentType: string; data: string }[] = [];
  if (input.kind === "confirm") {
    const ics = icsInvite({
      uid: `ticket-${ticket.number}-${input.start.replace(/[^0-9]/g, "")}@${new URL(env.appUrl).host}`,
      title: input.title.trim().slice(0, 200) || ticket.subject,
      description: `Ticket #${ticket.number}: ${ticket.subject}\n${env.appUrl}/tickets/${ticket.number}`,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      organizer: { name: TEAM_NAME, email: env.groupEmail },
      attendee: { name: ticket.requesterName, email: ticket.requesterEmail },
      prodId: "-//Groupdesk//Ticket invite//EN",
    });
    // Never send an invite a strict parser rejects; the requester's client would drop it silently.
    const check = checkInvite(ics);
    if (!check.ok) return { error: `Invite could not be generated: ${check.error}` };
    attachments = [{ filename: "invite.ics", contentType: "text/calendar; method=REQUEST", data: Buffer.from(ics, "utf8").toString("base64") }];
  }

  try {
    await sendReply({
      ticketId: ticket.id,
      agent,
      to: [ticket.requesterEmail],
      cc: [],
      bcc: [],
      bodyText: text,
      bodyHtml: null,
      attachments,
    });
  } catch (err) {
    return { error: `Send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  revalidatePath(`/tickets/${ticket.number}`);
  return { ok: input.kind === "confirm" ? "Confirmation sent with invite" : "Asked the requester to confirm" };
}
