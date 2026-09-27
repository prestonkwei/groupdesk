import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { gmailFor } from "./client";
import { ingestGmailMessage } from "./ingest";

export type BackfillBatch = {
  matched: number;
  ingested: number;
  skipped: number;
  failed: number;
  remaining: number;
  firstError: string | null;
};

/** Gmail search for past group mail, e.g. `list:help.example.org after:2026/01/01`. */
export function backfillQuery(base: string, after?: string, before?: string) {
  let q = base.trim();
  if (after) q += ` after:${after.replaceAll("-", "/")}`;
  if (before) q += ` before:${before.replaceAll("-", "/")}`;
  return q;
}

/**
 * Import past mail matching `query`, oldest first, so threads build in order
 * and the original sender becomes the requester. Stops after `budgetMs` and
 * reports what is left; call again to continue. Already-ingested messages are
 * filtered out up front, so repeat calls only pay for new work.
 *
 * Does not touch gmail_sync's history cursor, so it can run alongside the watch.
 */
export async function backfillBatch(
  query: string,
  budgetMs = Infinity,
): Promise<BackfillBatch> {
  const started = Date.now();
  const { client } = await gmailFor();

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await client.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });
    for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  ids.reverse(); // messages.list is newest first

  const done = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: messages.gmailMessageId })
      .from(messages)
      .where(inArray(messages.gmailMessageId, ids.slice(i, i + 500)));
    for (const r of rows) if (r.id) done.add(r.id);
  }
  const pending = ids.filter((id) => !done.has(id));

  let ingested = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | null = null;
  let processed = 0;

  for (const id of pending) {
    if (Date.now() - started > budgetMs) break;
    processed++;
    try {
      const result = await ingestGmailMessage(client, id);
      if (result.status === "ingested") ingested++;
      else skipped++;
    } catch (err) {
      failed++;
      firstError ??= err instanceof Error ? err.message : String(err);
      console.error(`backfill: ingest failed for gmail message ${id}`, err);
    }
  }

  return {
    matched: ids.length,
    ingested,
    skipped,
    failed,
    remaining: pending.length - processed,
    firstError,
  };
}
