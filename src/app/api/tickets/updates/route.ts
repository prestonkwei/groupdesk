import { after } from "next/server";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, ticketPresence, tickets } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { catchUpIfStale } from "@/lib/gmail/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * The portal's 5-second poll. Returns what the client needs to decide whether
 * to call router.refresh() (a count and the newest timestamp), and on a
 * ticket page also records the caller's presence and returns who else is
 * there. It doubles as the trigger for the periodic Gmail catch-up sync.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since");
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

  // Presence: only written when 15s have passed or "replying" flipped, so an
  // open tab costs one tiny write per 15 seconds at most.
  let viewers: { name: string; email: string; replying: boolean }[] | undefined;
  const ticketId = url.searchParams.get("ticket");
  if (ticketId && UUID_RE.test(ticketId)) {
    const replying = url.searchParams.get("replying") === "1";
    await db
      .insert(ticketPresence)
      .values({ ticketId, agentId: session.agent.id, replying })
      .onConflictDoUpdate({
        target: [ticketPresence.ticketId, ticketPresence.agentId],
        set: { replying, seenAt: sql`now()` },
        setWhere: sql`${ticketPresence.seenAt} < now() - interval '15 seconds' or ${ticketPresence.replying} <> excluded.replying`,
      })
      .catch(() => {}); // ticket deleted mid-poll: nothing to record
    viewers = await db
      .select({ name: agents.name, email: agents.email, replying: ticketPresence.replying })
      .from(ticketPresence)
      .innerJoin(agents, eq(agents.id, ticketPresence.agentId))
      .where(
        and(
          eq(ticketPresence.ticketId, ticketId),
          ne(ticketPresence.agentId, session.agent.id),
          sql`${ticketPresence.seenAt} > now() - interval '35 seconds'`,
        ),
      );
  }

  after(async () => {
    await catchUpIfStale().catch(() => {});
    // Now and then, forget presence rows nobody has refreshed in a day.
    if (Math.random() < 0.01) {
      await db
        .delete(ticketPresence)
        .where(sql`${ticketPresence.seenAt} < now() - interval '1 day'`)
        .catch(() => {});
    }
  });

  return Response.json({
    changed: row?.changed ?? 0,
    latest: row?.latest ?? null,
    now: new Date().toISOString(),
    viewers,
  });
}
