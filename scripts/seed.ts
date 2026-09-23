/* Seed the first admin plus a couple of starter teams and tags. */
import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { agents, tags, teams } from "../src/db/schema";
import { slugify } from "../src/lib/utils";

if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Admin";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!ADMIN_EMAIL) throw new Error("Set SEED_ADMIN_EMAIL to your school address");

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { casing: "snake_case" });

  await db
    .insert(agents)
    .values({ email: ADMIN_EMAIL.toLowerCase(), name: ADMIN_NAME, role: "admin" })
    .onConflictDoNothing();

  for (const name of ["Help Desk", "Infrastructure"]) {
    await db.insert(teams).values({ name, slug: slugify(name) }).onConflictDoNothing();
  }

  for (const [name, color] of [
    ["Chromebook", "blue"],
    ["Printing", "amber"],
    ["Account", "violet"],
    ["Urgent", "rose"],
  ] as const) {
    await db
      .insert(tags)
      .values({ name, slug: slugify(name), color })
      .onConflictDoNothing();
  }

  await pool.end();
  console.log(`seeded; ${ADMIN_EMAIL} is an admin`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
