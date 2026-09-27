/*
 * Import past group mail that predates the watch (the /admin/gmail Backfill
 * button does the same from the browser). The regular sync only looks back
 * 7 days; this feeds every match for a Gmail search through the ingest
 * pipeline, oldest first.
 *
 *   pnpm gmail:backfill --after 2026-08-01
 *   pnpm gmail:backfill --query "list:help.example.org" --dry-run
 *
 * Safe to re-run: messages already ingested are skipped.
 */
import "./load-env";
import { env } from "../src/lib/env";
import { backfillBatch, backfillQuery } from "../src/lib/gmail/backfill";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const query = backfillQuery(
    arg("query") ?? `label:"${env.labelName}"`,
    arg("after"),
    arg("before"),
  );
  console.log(`query: ${query}`);

  // A zero budget lists and dedupes without ingesting anything.
  const result = await backfillBatch(query, dryRun ? 0 : Infinity);
  if (dryRun) {
    console.log(`matched: ${result.matched}, not yet imported: ${result.remaining}`);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
}

main()
  .then(() => process.exit())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
