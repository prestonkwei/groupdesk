/* Print what actually exists in the database. Read-only. */
import "./load-env";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tables = await pool.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`,
  );
  console.log("tables:", tables.rows.map((r) => r.table_name).join(", "));

  const seq = await pool.query(
    `select last_value, is_called from ticket_number_seq`,
  );
  console.log("ticket_number_seq:", JSON.stringify(seq.rows[0]));

  const enums = await pool.query(
    `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) vals
       from pg_type t join pg_enum e on e.enumtypid = t.oid
      group by t.typname order by t.typname`,
  );
  for (const r of enums.rows) console.log(`enum ${r.typname}: ${r.vals}`);

  const idx = await pool.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and indexname like '%_key'
      order by indexname`,
  );
  console.log("unique indexes:", idx.rows.map((r) => r.indexname).join(", "));

  const counts = await pool.query(
    `select 'agents' t, count(*)::int n from agents
     union all select 'teams', count(*)::int from teams
     union all select 'tags', count(*)::int from tags
     union all select 'tickets', count(*)::int from tickets
     union all select 'messages', count(*)::int from messages
     union all select 'gmail_sync', count(*)::int from gmail_sync
     order by t`,
  );
  console.log("rows:", counts.rows.map((r) => `${r.t}=${r.n}`).join(" "));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
