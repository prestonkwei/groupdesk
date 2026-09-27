import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { events, tickets } from "@/db/schema";

/** Days a pending ticket waits for the requester before it's marked solved. */
export const AUTO_SOLVE_DAYS = Number(process.env.AUTO_SOLVE_DAYS) || 7;

/**
 * Pending means "we replied, waiting on them". If nothing has arrived for
 * AUTO_SOLVE_DAYS, mark it solved (never closed: closed is for non-requests).
 * A later reply from them reopens it as usual.
 */
export async function autoSolveStale(): Promise<{ solved: number }> {
  const cutoff = new Date(Date.now() - AUTO_SOLVE_DAYS * 86_400_000);
  const stale = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.status, "pending"), lt(tickets.lastMessageAt, cutoff)))
    .limit(500);
  if (!stale.length) return { solved: 0 };

  const ids = stale.map((t) => t.id);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(tickets)
      .set({ status: "solved", updatedAt: now })
      .where(and(inArray(tickets.id, ids), eq(tickets.status, "pending")));
    await tx.insert(events).values(
      ids.map((ticketId) => ({
        ticketId,
        kind: "status",
        data: { from: "pending", to: "solved", auto: true, days: AUTO_SOLVE_DAYS },
      })),
    );
  });
  return { solved: ids.length };
}
