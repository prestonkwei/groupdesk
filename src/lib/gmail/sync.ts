import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { gmailSync } from "@/db/schema";
import { env } from "@/lib/env";
import { gmailFor, recordError, resolveLabelId, type GmailClient } from "./client";
import { ingestGmailMessage } from "./ingest";

export type SyncSummary = {
  email: string;
  scanned: number;
  ingested: number;
  skipped: number;
  fullResync: boolean;
  newHistoryId: string | null;
};

function isNotFound(err: unknown): boolean {
  const e = err as {
    code?: number;
    status?: number;
    response?: { status?: number };
  };
  return e?.code === 404 || e?.status === 404 || e?.response?.status === 404;
}

/**
 * Pull everything that changed since our stored historyId and ingest it.
 *
 * The whole pass runs inside a transaction holding `SELECT ... FOR UPDATE` on
 * the gmail_sync row, so an overlapping push (or the reconcile cron racing a
 * push) queues behind it instead of walking the same history window twice.
 * A worker that can't get the lock within 25s throws, which becomes a 500 and
 * a Pub/Sub retry.
 */
export async function syncFromHistory(options?: {
  email?: string;
  markPush?: boolean;
}): Promise<SyncSummary> {
  const { client, email } = await gmailFor(options?.email);

  try {
    const summary = await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '25s'`);

      const locked = await tx.execute<{
        last_history_id: string | null;
        label_id: string | null;
      }>(
        sql`select last_history_id, label_id
              from gmail_sync
             where email = ${email}
               for update`,
      );

      const row = (locked.rows ?? [])[0];
      if (!row) throw new Error(`gmail_sync row for ${email} disappeared`);

      const labelId = await resolveLabelId(client, row.label_id);
      const startHistoryId = row.last_history_id;

      const result = startHistoryId
        ? await walkHistory(client, labelId, startHistoryId)
        : await fullResync(client, labelId);

      const now = new Date();
      await tx
        .update(gmailSync)
        .set({
          labelId,
          lastHistoryId: result.newHistoryId ?? startHistoryId,
          lastSyncAt: now,
          ...(options?.markPush ? { lastPushAt: now } : {}),
          lastError: null,
        })
        .where(eq(gmailSync.email, email));

      return { email, ...result };
    });

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordError(email, message).catch(() => {});
    throw err;
  }
}

/* --------------------------------------------------------------- history */

async function walkHistory(
  client: GmailClient,
  labelId: string,
  startHistoryId: string,
): Promise<Omit<SyncSummary, "email">> {
  const ids = new Set<string>();
  let newHistoryId: string | null = null;
  let pageToken: string | undefined;

  try {
    do {
      const { data } = await client.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        labelId,
        maxResults: 500,
        pageToken,
      });

      for (const h of data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.id) ids.add(added.message.id);
        }
      }

      if (data.historyId) newHistoryId = data.historyId;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    // Stored historyId aged out (Gmail keeps roughly a week). Start over from
    // a message listing; the gmail_message_id unique constraint dedupes.
    return fullResync(client, labelId);
  }

  const counts = await ingestAll(client, [...ids]);
  return { ...counts, fullResync: false, newHistoryId };
}

async function fullResync(
  client: GmailClient,
  labelId: string,
): Promise<Omit<SyncSummary, "email">> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await client.users.messages.list({
      userId: "me",
      labelIds: [labelId],
      q: "newer_than:7d",
      maxResults: 100,
      pageToken,
    });
    for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  const counts = await ingestAll(client, ids);

  // Re-anchor on the mailbox's current historyId so the next pass is cheap.
  const { data: profile } = await client.users.getProfile({ userId: "me" });

  return {
    ...counts,
    fullResync: true,
    newHistoryId: profile.historyId ?? null,
  };
}

async function ingestAll(client: GmailClient, ids: string[]) {
  let ingested = 0;
  let skipped = 0;

  for (const id of ids) {
    try {
      const result = await ingestGmailMessage(client, id);
      if (result.status === "ingested") ingested++;
      else skipped++;
    } catch (err) {
      console.error(`ingest failed for gmail message ${id}`, err);
      throw err;
    }
  }

  return { scanned: ids.length, ingested, skipped };
}

/* ----------------------------------------------------------------- watch */

export type WatchResult = { historyId: string; expiration: Date };

/** (Re)start the Gmail push watch. Calling it again replaces the existing one. */
export async function startWatch(email?: string): Promise<WatchResult> {
  const { client, email: mailbox } = await gmailFor(email);

  const [row] = await db
    .select()
    .from(gmailSync)
    .where(eq(gmailSync.email, mailbox))
    .limit(1);

  const labelId = await resolveLabelId(client, row?.labelId);

  const watch = () =>
    client.users.watch({
      userId: "me",
      requestBody: {
        topicName: env.pubsubTopic,
        labelIds: [labelId],
        labelFilterBehavior: "include",
      },
    });

  // Gmail sometimes refuses to replace a live watch ("Only one user push
  // notification client allowed per developer"). Stop it and watch again;
  // the stored history cursor covers anything that lands in between.
  const { data } = await watch().catch(async (err: unknown) => {
    if (!/only one user push notification client/i.test(String(err))) throw err;
    await client.users.stop({ userId: "me" });
    return watch();
  });

  if (!data.historyId || !data.expiration) {
    throw new Error("users.watch returned no historyId/expiration");
  }

  const expiration = new Date(Number(data.expiration));

  await db
    .update(gmailSync)
    .set({
      labelId,
      watchExpiration: expiration,
      // Only seed lastHistoryId the first time; otherwise we'd skip the window
      // between the last sync and this renewal.
      ...(row?.lastHistoryId ? {} : { lastHistoryId: data.historyId }),
      lastError: null,
    })
    .where(eq(gmailSync.email, mailbox));

  return { historyId: data.historyId, expiration };
}
