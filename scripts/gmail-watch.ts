/* Start or renew the Gmail watch from the command line (build step 3). */
import "dotenv/config";
import { startWatch } from "../src/lib/gmail/sync";

startWatch()
  .then((r) =>
    console.log(`watch started; historyId=${r.historyId} expires=${r.expiration.toISOString()}`),
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
