import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { gmailSync } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { oauthClient } from "@/lib/gmail/client";
import { gmail } from "@googleapis/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gmail_oauth_state";

function back(message: string, ok = false) {
  const q = new URLSearchParams(ok ? { ok: message } : { error: message });
  redirect(`/admin/gmail?${q}`);
}

export async function GET(req: Request) {
  await requireAdmin();

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

  const email = profile.emailAddress!;

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
