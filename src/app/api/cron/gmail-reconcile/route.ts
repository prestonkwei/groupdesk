import { cronAuthorized } from "@/lib/cron-auth";
import { syncFromHistory } from "@/lib/gmail/sync";
import { getSyncRow } from "@/lib/gmail/client";
import { alert } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Safety net for dropped pushes. Runs the identical history sync, so anything
 * a push missed lands within one interval. Pub/Sub gives speed; this gives
 * the guarantee.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const row = await getSyncRow();
  if (!row) return Response.json({ ok: true, skipped: "no mailbox connected" });

  try {
    const summary = await syncFromHistory();
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alert("Gmail reconcile failed", message);
    return new Response(message, { status: 500 });
  }
}

export const POST = GET;
