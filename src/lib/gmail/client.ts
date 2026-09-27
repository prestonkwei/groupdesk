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
  // Workspace directory profile photos for avatars (src/lib/people.ts).
  "https://www.googleapis.com/auth/directory.readonly",
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
 * OAuth client authorised as the connected mailbox. Throws a clear error when
 * nothing is connected — the /admin/gmail page surfaces that as "reconnect".
 */
export async function googleAuthFor(email?: string) {
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

  return { auth: client, email: row.email };
}

/** Gmail client authorised as the connected mailbox. */
export async function gmailFor(email?: string): Promise<{
  client: GmailClient;
  email: string;
}> {
  const { auth: client, email: mailbox } = await googleAuthFor(email);
  return { client: gmail({ version: "v1", auth: client }), email: mailbox };
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

export type SendAsStatus = "verified" | "pending" | "missing" | "unknown";

/**
 * Whether the connected mailbox may send as `address`. Replies set
 * From: "Agent <group address>", which Gmail only honours for a verified
 * "Send mail as" alias; otherwise it silently uses the mailbox itself.
 */
export async function sendAsStatus(address: string): Promise<SendAsStatus> {
  try {
    const { client } = await gmailFor();
    const { data } = await client.users.settings.sendAs.list({ userId: "me" });
    const match = (data.sendAs ?? []).find(
      (s) => s.sendAsEmail?.toLowerCase() === address.toLowerCase(),
    );
    if (!match) return "missing";
    return match.isPrimary || match.verificationStatus === "accepted" ? "verified" : "pending";
  } catch {
    return "unknown";
  }
}
