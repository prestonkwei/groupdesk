/*
 * Run the ingest pipeline by hand against real group mail (build step 2).
 * This is where the edge cases show up — run it before wiring up the watch.
 */
import "dotenv/config";
import { syncFromHistory } from "../src/lib/gmail/sync";

syncFromHistory()
  .then((s) => console.log(JSON.stringify(s, null, 2)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
