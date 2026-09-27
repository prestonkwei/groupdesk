/*
 * Import past group mail that predates the watch. The regular sync only looks
 * back 7 days; this walks any Gmail search and feeds every match through the
 * same ingest pipeline, oldest first, so threads build in order and the
 * original sender becomes the requester.
 *
 *   pnpm gmail:backfill --after 2026-08-01
 *   pnpm gmail:backfill --query "list:help.example.org" --dry-run
 *
 * Safe to re-run: messages already ingested are skipped by gmail_message_id.
 * It does not touch gmail_sync's history cursor, so it can run alongside the
 * live watch.
 */
import "./load-env";
import { env } from "../src/lib/env";
import { gmailFor } from "../src/lib/gmail/client";
import { ingestGmailMessage } from "../src/lib/gmail/ingest";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const after = arg("after"); // YYYY-MM-DD
  const before = arg("before"); // YYYY-MM-DD

  let query = arg("query") ?? `label:"${env.labelName}"`;
  if (after) query += ` after:${after.replaceAll("-", "/")}`;
  if (before) query += ` before:${before.replaceAll("-", "/")}`;

  const { client, email } = await gmailFor();
  console.log(`mailbox: ${email}\nquery:   ${query}`);

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

  // messages.list is newest first.
  ids.reverse();
  console.log(`matched: ${ids.length}`);
  if (dryRun || !ids.length) return;

  let ingested = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, id] of ids.entries()) {
    try {
      const result = await ingestGmailMessage(client, id);
      if (result.status === "ingested") ingested++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error(`ingest failed for gmail message ${id}`, err);
    }
    if ((i + 1) % 50 === 0) {
      console.log(`${i + 1}/${ids.length}  ingested=${ingested} skipped=${skipped} failed=${failed}`);
    }
  }

  console.log(
    JSON.stringify({ scanned: ids.length, ingested, skipped, failed }, null, 2),
  );
  if (failed) process.exitCode = 1;
}

main()
  .then(() => process.exit())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
