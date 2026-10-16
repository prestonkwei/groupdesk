import "server-only";
import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentCalendars } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { oauthClient } from "@/lib/gmail/client";
import { findSlots, type Busy, type Slot } from "@/lib/dates";

/**
 * Per-agent Google Calendar access. Reuses the Gmail OAuth client (same
 * Google Cloud project, same registered redirect URI) with calendar scopes;
 * the token is the agent's own, not the mailbox's.
 */
export const CALENDAR_SCOPES = [
  // Read busy times (with titles, for "Busy: Staff meeting") and create events.
  "https://www.googleapis.com/auth/calendar.events",
  // freebusy.query, for "suggest a time".
  "https://www.googleapis.com/auth/calendar.freebusy",
  // To record which Google account was connected.
  "https://www.googleapis.com/auth/userinfo.email",
];

export function calendarConsentUrl(state: string, loginHint?: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    login_hint: loginHint,
    scope: CALENDAR_SCOPES,
    state,
  });
}

export async function calendarConnection(agentId: string) {
  const [row] = await db
    .select()
    .from(agentCalendars)
    .where(eq(agentCalendars.agentId, agentId))
    .limit(1);
  return row ?? null;
}

/**
 * Load the agent's connection, run `fn` against their calendar, and record
 * the outcome: a failure is saved to last_error, a success clears it only if
 * one was set (so ordinary lookups don't write). Null when not connected.
 */
async function withCalendar<T>(agentId: string, fn: (api: calendar_v3.Calendar) => Promise<T>): Promise<T | null> {
  const row = await calendarConnection(agentId);
  if (!row) return null;
  try {
    const auth = oauthClient();
    auth.setCredentials({ refresh_token: decryptSecret(row.refreshTokenEnc) });
    const result = await fn(calendar({ version: "v3", auth }));
    if (row.lastError) {
      await db.update(agentCalendars).set({ lastError: null }).where(eq(agentCalendars.agentId, agentId));
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== row.lastError) {
      await db
        .update(agentCalendars)
        .set({ lastError: message })
        .where(eq(agentCalendars.agentId, agentId))
        .catch(() => {});
    }
    throw err;
  }
}

/** Same shape as the toolkit's `Busy`. */
export type BusySlot = Busy;

const MAX_EVENTS = 250;

/** Events on the agent's primary calendar overlapping [start, end). Null when not connected. */
export async function busyBetween(agentId: string, start: string, end: string): Promise<BusySlot[] | null> {
  return withCalendar(agentId, async (api) => {
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await api.events.list({
        calendarId: "primary",
        timeMin: start,
        timeMax: end,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: MAX_EVENTS,
        pageToken,
      });
      items.push(...(data.items ?? []));
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && items.length < MAX_EVENTS);
    return items
      .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent")
      .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === "declined"))
      .map((e) => ({
        start: e.start?.dateTime ?? e.start?.date ?? start,
        end: e.end?.dateTime ?? e.end?.date ?? end,
        title: e.summary ?? null,
        allDay: !e.start?.dateTime,
      }));
  });
}

export async function createEvent(
  agentId: string,
  input: { title: string; description?: string; start: string; end: string; allDay: boolean; tz: string },
): Promise<{ htmlLink: string | null } | null> {
  return withCalendar(agentId, async (api) => {
    const time = input.allDay
      ? { start: { date: input.start }, end: { date: input.end } }
      : {
          start: { dateTime: input.start, timeZone: input.tz },
          end: { dateTime: input.end, timeZone: input.tz },
        };
    const { data } = await api.events.insert({
      calendarId: "primary",
      requestBody: { summary: input.title, description: input.description, ...time },
    });
    return { htmlLink: data.htmlLink ?? null };
  });
}

/** Up to three free school-hours slots of `durationMin` starting at or after `from`. Null when not connected. */
export async function suggestSlots(agentId: string, from: string, durationMin: number): Promise<Slot[] | null> {
  const DAYS = 14;
  const timeMax = new Date(new Date(from).getTime() + DAYS * 24 * 60 * 60_000).toISOString();
  return withCalendar(agentId, async (api) => {
    const { data } = await api.freebusy.query({
      requestBody: { timeMin: from, timeMax, items: [{ id: "primary" }] },
    });
    const busy = (data.calendars?.primary?.busy ?? [])
      .filter((b): b is { start: string; end: string } => !!b.start && !!b.end)
      .map((b) => ({ start: b.start, end: b.end }));
    return findSlots(busy, { from, durationMin, days: DAYS });
  });
}
