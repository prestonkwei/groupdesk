import { gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cheap poll target for the ticket list. Returns only what the client needs to
 * decide whether to call router.refresh(): a count and the newest timestamp.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const since = new URL(req.url).searchParams.get("since");
  const cutoff = since ? new Date(since) : new Date(Date.now() - 60_000);
  if (Number.isNaN(cutoff.getTime())) {
    return new Response("Bad `since`", { status: 400 });
  }

  const [row] = await db
    .select({
      changed: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${tickets.updatedAt})`,
    })
    .from(tickets)
    .where(gt(tickets.updatedAt, cutoff));

  return Response.json({
    changed: row?.changed ?? 0,
    latest: row?.latest ?? null,
    now: new Date().toISOString(),
  });
}
