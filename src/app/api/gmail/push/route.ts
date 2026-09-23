import { OAuth2Client } from "google-auth-library";
import { env } from "@/lib/env";
import { syncFromHistory } from "@/lib/gmail/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const verifier = new OAuth2Client();

type PushEnvelope = {
  message?: { data?: string; messageId?: string; publishTime?: string };
  subscription?: string;
};

/**
 * Pub/Sub push endpoint.
 *
 * Returns 200 on success and 500 on failure so Pub/Sub retries; ingestion is
 * idempotent (unique gmail_message_id), so a retry is harmless. 401/400 are
 * terminal — retrying a bad token or a malformed body never helps, and we'd
 * rather the message go to the dead-letter topic.
 */
export async function POST(req: Request) {
  // 1. Verify the Pub/Sub OIDC token.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return new Response("Missing bearer token", { status: 401 });

  try {
    const ticket = await verifier.verifyIdToken({
      idToken: token,
      audience: env.pushAudience,
    });
    const payload = ticket.getPayload();
    if (
      !payload ||
      payload.email !== env.pushServiceAccount ||
      payload.email_verified !== true
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
  } catch (err) {
    console.error("pubsub token verification failed", err);
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Decode the notification. It's only a signal that something changed —
  //    the historyId inside it is deliberately ignored in favour of ours.
  let notification: { emailAddress?: string; historyId?: string } = {};
  try {
    const envelope = (await req.json()) as PushEnvelope;
    if (envelope.message?.data) {
      notification = JSON.parse(
        Buffer.from(envelope.message.data, "base64").toString("utf8"),
      );
    }
  } catch (err) {
    console.error("malformed pubsub envelope", err);
    return new Response("Bad Request", { status: 400 });
  }

  // 3. Sync from our own stored historyId, under the row lock.
  try {
    const summary = await syncFromHistory({
      email: notification.emailAddress,
      markPush: true,
    });
    console.log("[gmail push]", JSON.stringify(summary));
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error("gmail push sync failed", err);
    return new Response("Sync failed", { status: 500 });
  }
}
