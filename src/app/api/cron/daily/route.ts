import { cronAuthorized } from "@/lib/cron-auth";
import { autoSolveStale } from "@/lib/auto-solve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily housekeeping: auto-solve pending tickets nobody has answered. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const result = await autoSolveStale();
  return Response.json({ ok: true, ...result });
}

export const POST = GET;
