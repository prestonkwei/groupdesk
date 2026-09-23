import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// The WebSocket driver (not the HTTP one) is what gives us real interactive
// transactions, which the push handler needs for SELECT ... FOR UPDATE.
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

declare global {
  var __ticketsPool: Pool | undefined;
  var __ticketsDb: NeonDatabase<typeof schema> | undefined;
}

function connect(): NeonDatabase<typeof schema> {
  if (!globalThis.__ticketsDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__ticketsPool ??= new Pool({ connectionString: url });
    globalThis.__ticketsDb = drizzle(globalThis.__ticketsPool, {
      schema,
      casing: "snake_case",
    });
  }
  return globalThis.__ticketsDb;
}

/**
 * Lazy: the connection is opened on first query, not at module load, so
 * `next build` can collect page data without DATABASE_URL present.
 */
export const db: NeonDatabase<typeof schema> = new Proxy(
  {} as NeonDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const value = Reflect.get(connect(), prop, receiver);
      return typeof value === "function" ? value.bind(connect()) : value;
    },
  },
);

export { schema };
export type Db = NeonDatabase<typeof schema>;
/** The type handed to a `db.transaction(async (tx) => ...)` callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
