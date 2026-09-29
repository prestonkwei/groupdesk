import "server-only";
import { env } from "./env";
import { APP_NAME } from "./utils";

/**
 * Best-effort operational alert. Never throws — an alert failing must not turn
 * a recoverable sync error into a hard 500 loop.
 */
export async function alert(subject: string, detail: string) {
  console.error(`[alert] ${subject}\n${detail}`);

  if (env.slackWebhook) {
    try {
      await fetch(env.slackWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `*${subject}*\n${detail}` }),
      });
    } catch (err) {
      console.error("slack alert failed", err);
    }
  }

  if (env.alertEmailTo) {
    try {
      const { gmailFor } = await import("./gmail/client");
      const { createMimeMessage } = await import("mimetext");
      const { client, email } = await gmailFor();
      const msg = createMimeMessage();
      msg.setSender({ name: APP_NAME, addr: email });
      msg.setRecipient(env.alertEmailTo);
      msg.setSubject(`[${APP_NAME}] ${subject}`);
      msg.addMessage({ contentType: "text/plain", data: detail });
      await client.users.messages.send({
        userId: "me",
        requestBody: { raw: Buffer.from(msg.asRaw()).toString("base64url") },
      });
    } catch (err) {
      console.error("email alert failed", err);
    }
  }
}
