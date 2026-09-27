import { cronAuthorized } from "@/lib/cron-auth";
import { isDigestHour, sendWeeklyDigests } from "@/lib/digest";
import { alert } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Weekly digest. Vercel cron runs in UTC with no DST, so vercel.json fires
 * this at both 23:00 Fri and 00:00 Sat UTC; only the one that lands in 4pm
 * Friday Pacific sends. `?force=1` skips the clock check (still once per agent
 * per 3 days).
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && !isDigestHour()) return Response.json({ ok: true, skipped: "not 4pm Friday Pacific" });

  const results = await sendWeeklyDigests();
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    await alert(
      "Weekly digest partly failed",
      failed.map((f) => `${f.email}: ${f.error}`).join("\n"),
    );
  }
  return Response.json({ ok: failed.length === 0, sent: results.length - failed.length, failed });
}

export const POST = GET;
