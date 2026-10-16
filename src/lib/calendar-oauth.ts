import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { agentCalendars } from "@/db/schema";
import { requireAgent } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { calendarConnection } from "@/lib/calendar";
import { oauthClient } from "@/lib/gmail/client";

/**
 * Google sends every consent back to the one redirect URI registered for the
 * app (the Gmail one), so /api/admin/gmail/callback hands over to this when
 * `state` starts with CALENDAR_STATE_PREFIX. The cookie holds JSON
 * {state, next} so we can return to the ticket the agent was reading.
 */
export const CALENDAR_STATE_COOKIE = "calendar_oauth_state";
export const CALENDAR_STATE_PREFIX = "cal.";

const DEFAULT_NEXT = "/tickets";

/** A same-origin path only: one leading slash, never `//` or `/\`, no scheme or host. */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length > 500) return DEFAULT_NEXT;
  if (!/^\/(?!\/|\\)[\w\-./%?=&]*$/.test(next)) return DEFAULT_NEXT;
  // URL normalisation resolves dot segments, so "/.//evil.com" would become
  // "//evil.com": refuse dot segments and empty segments in the path.
  const path = next.split("?")[0];
  if (path.includes("//") || path.split("/").some((seg) => seg === "." || seg === "..")) return DEFAULT_NEXT;
  return next;
}

function parseCookie(raw: string): { state: string; next: string } {
  try {
    const v = JSON.parse(raw) as { state?: unknown; next?: unknown };
    return { state: typeof v.state === "string" ? v.state : "", next: safeNext(typeof v.next === "string" ? v.next : null) };
  } catch {
    return { state: "", next: DEFAULT_NEXT };
  }
}

export async function handleCalendarCallback(req: Request, stateCookie: string | undefined): Promise<void> {
  const { agent } = await requireAgent();
  const { state: expected, next } = parseCookie(stateCookie ?? "");
  const back = (calendar: string): never => {
    // `next` was validated, so this stays on our own origin.
    const url = new URL(next, "http://x");
    url.searchParams.set("calendar", calendar);
    redirect(url.pathname + url.search);
  };

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) back(`Google returned: ${error}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!state || !expected || state !== expected) back("State mismatch — try connecting again");
  if (!code) back("No authorisation code in the callback");

  const client = oauthClient();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code!));
  } catch (err) {
    return back(`Could not complete the Google sign-in: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  const granted = (tokens.scope ?? "").split(/\s+/);
  const needed = ["calendar.events", "calendar.freebusy"];
  if (!needed.every((s) => granted.some((g) => g.endsWith(`/auth/${s}`)))) {
    const t = tokens.refresh_token ?? tokens.access_token;
    if (t) await client.revokeToken(t).catch(() => {});
    back("Calendar access wasn't granted. Connect again and leave the calendar boxes ticked.");
  }
  if (!tokens.refresh_token) {
    back("Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
  }
  const refreshToken = tokens.refresh_token as string;

  client.setCredentials(tokens);
  let email: string;
  try {
    const info = await client.getTokenInfo(tokens.access_token as string);
    email = (info.email ?? agent.email).toLowerCase();
  } catch (err) {
    await client.revokeToken(refreshToken).catch(() => {});
    return back(`Could not read the Google account: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // Replace any earlier connection. Revoking a token revokes its whole grant,
  // so only do it when the old one belonged to a different Google account;
  // for the same account Google has already superseded it.
  const previous = await calendarConnection(agent.id);
  if (previous && previous.email !== email) {
    try {
      await oauthClient().revokeToken(decryptSecret(previous.refreshTokenEnc));
    } catch {
      /* already revoked or undecryptable: nothing to do */
    }
  }

  const enc = encryptSecret(refreshToken);
  await db
    .insert(agentCalendars)
    .values({ agentId: agent.id, email, refreshTokenEnc: enc, connectedAt: new Date(), lastError: null })
    .onConflictDoUpdate({
      target: agentCalendars.agentId,
      set: { email, refreshTokenEnc: enc, connectedAt: new Date(), lastError: null },
    });

  back(`Connected ${email}`);
}
