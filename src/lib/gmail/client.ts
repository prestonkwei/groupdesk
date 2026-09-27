import "server-only";
import { gmail, auth, type gmail_v1 } from "@googleapis/gmail";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gmailSync } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

export function oauthClient() {
  return new auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri,
  );
}

export function consentUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    login_hint: env.gmailMailbox,
    scope: GMAIL_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

/** The GMAIL_MAILBOX sync row, or null if it hasn't been connected yet. */
export async function getSyncRow() {
  const [row] = await db
    .select()
    .from(gmailSync)
    .where(eq(gmailSync.email, env.gmailMailbox))
    .limit(1);
  return row ?? null;
}

export type GmailClient = gmail_v1.Gmail;

/**
 * Gmail client authorised as the connected mailbox. Throws a clear error when
 * nothing is connected or the refresh token has been revoked — the /admin/gmail
 * page surfaces that as "reconnect".
 */
export async function gmailFor(email?: string): Promise<{
  client: GmailClient;
  email: string;
}> {
  const row = email
    ? ((await db
        .select()
        .from(gmailSync)
        .where(eq(gmailSync.email, email))
        .limit(1)) ?? [])[0]
    : await getSyncRow();

  if (!row) throw new Error("No Gmail account is connected. Visit /admin/gmail.");

  const client = oauthClient();
  client.setCredentials({
    refresh_token: decryptSecret(row.refreshTokenEnc),
  });

  return { client: gmail({ version: "v1", auth: client }), email: row.email };
}

/**
 * Resolve the id of the label we watch. Callers persist it with their own
 * gmail_sync update: writing it here, on a separate connection, deadlocked
 * syncFromHistory, which already holds that row FOR UPDATE.
 */
export async function resolveLabelId(
  client: GmailClient,
  cached?: string | null,
): Promise<string> {
  if (cached) return cached;
  const { data } = await client.users.labels.list({ userId: "me" });
  const label = (data.labels ?? []).find(
    (l) => l.name?.toLowerCase() === env.labelName.toLowerCase(),
  );
  if (!label?.id) {
    throw new Error(
      `Gmail label "${env.labelName}" not found. Create the filter/label in Gmail first.`,
    );
  }
  return label.id;
}

export async function recordError(email: string, message: string | null) {
  await db
    .update(gmailSync)
    .set({ lastError: message })
    .where(eq(gmailSync.email, email));
}
