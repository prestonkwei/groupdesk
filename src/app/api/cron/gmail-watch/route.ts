import { env } from "@/lib/env";
import { cronAuthorized } from "@/lib/cron-auth";
import { startWatch } from "@/lib/gmail/sync";
import { getSyncRow } from "@/lib/gmail/client";
import { alert } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOURS_48 = 48 * 60 * 60 * 1000;

/**
 * Daily watch renewal. A watch lasts 7 days; Google recommends renewing daily,
 * and calling watch again simply replaces the existing registration.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const row = await getSyncRow();
  if (!row) {
    await alert(
      "Gmail watch not renewed",
      "No mailbox is connected. Visit /admin/gmail and connect one.",
    );
    return Response.json({ ok: false, reason: "no mailbox connected" });
  }

  try {
    const { expiration, historyId } = await startWatch();
    const remaining = expiration.getTime() - Date.now();
    if (remaining < HOURS_48) {
      await alert(
        "Gmail watch expires soon",
        `Renewal succeeded but the new expiration is ${expiration.toISOString()}, under 48h away.`,
      );
    }
    return Response.json({
      ok: true,
      historyId,
      expiration: expiration.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alert(
      "Gmail watch renewal FAILED",
      `${message}\n\nIngestion will stop when the current watch expires` +
        (row.watchExpiration
          ? ` at ${row.watchExpiration.toISOString()}.`
          : ".") +
        `\nReconnect at ${env.appUrl}/admin/gmail`,
    );
    return new Response(message, { status: 500 });
  }
}

export const POST = GET;
