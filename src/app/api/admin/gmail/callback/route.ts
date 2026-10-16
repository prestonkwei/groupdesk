import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { gmailSync } from "@/db/schema";
import { requireGmailOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { encryptSecret } from "@/lib/crypto";
import { oauthClient } from "@/lib/gmail/client";
import { gmail } from "@googleapis/gmail";
import { CALENDAR_STATE_COOKIE, CALENDAR_STATE_PREFIX, handleCalendarCallback } from "@/lib/calendar-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gmail_oauth_state";

function back(message: string, ok = false) {
  const q = new URLSearchParams(ok ? { ok: message } : { error: message });
  redirect(`/admin/gmail?${q}`);
}

export async function GET(req: Request) {
  // One registered redirect URI serves both consents; an agent connecting
  // their own calendar arrives here too (see lib/calendar-oauth.ts). Dispatch
  // on `state`, not on a leftover cookie, so an abandoned calendar connect
  // can't capture the Gmail owner's callback.
  if (new URL(req.url).searchParams.get("state")?.startsWith(CALENDAR_STATE_PREFIX)) {
    const jar = await cookies();
    const calendarCookie = jar.get(CALENDAR_STATE_COOKIE)?.value;
    jar.delete(CALENDAR_STATE_COOKIE);
    return handleCalendarCallback(req, calendarCookie);
  }

  await requireGmailOwner();

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) back(`Google returned: ${error}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (!code) back("No authorisation code in the callback");
  if (!state || !expected || state !== expected) {
    back("State mismatch — start the connect flow again");
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(code!);

  if (!tokens.refresh_token) {
    back(
      "Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.",
    );
  }

  client.setCredentials(tokens);
  const { data: profile } = await gmail({ version: "v1", auth: client })
    .users.getProfile({ userId: "me" });

  if (!profile.emailAddress) back("Could not read the mailbox address");

  const email = profile.emailAddress!.toLowerCase();
  if (email !== env.gmailMailbox) {
    await client.revokeToken(tokens.refresh_token!).catch(() => {});
    back(`Signed in as ${email}. Connect with ${env.gmailMailbox} instead.`);
  }

  await db
    .insert(gmailSync)
    .values({
      email,
      refreshTokenEnc: encryptSecret(tokens.refresh_token!),
      connectedAt: new Date(),
      lastError: null,
    })
    .onConflictDoUpdate({
      target: gmailSync.email,
      set: {
        refreshTokenEnc: encryptSecret(tokens.refresh_token!),
        connectedAt: new Date(),
        lastError: null,
      },
    });

  back(`Connected ${email}`, true);
}
