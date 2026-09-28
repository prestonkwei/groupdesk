import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { TIME_ZONE } from "@/lib/utils";
import { SLA_TARGET_HOURS, schoolSecondsBetween } from "@/lib/sla";

export type ReportRange = "7d" | "30d" | "90d" | "365d" | "all";

export const RANGES: { value: ReportRange; label: string; days: number | null }[] = [
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "365d", label: "12 months", days: 365 },
  { value: "all", label: "All time", days: null },
];

type TicketRow = {
  id: string;
  created_at: Date;
  status: string;
  priority: string;
  team_id: string | null;
  team_name: string | null;
  first_in: Date | null;
  first_out: Date | null;
  resolved_at: Date | null;
};

export type Stat = {
  tickets: number;
  resolved: number;
  open: number;
  /** Seconds; null when nothing in the group has that measurement. */
  medianFirstResponse: number | null;
  medianResolve: number | null;
  responded: number;
  /** Answered within the priority's reply target (school hours). */
  withinTarget: number;
};

export type Breakdown = { key: string; label: string; color?: string } & Stat;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Durations count school hours only (Mon–Fri, 8–4), like the reply targets. */
const secs = (a: Date | null, b: Date | null) => (a && b ? schoolSecondsBetween(a, b) : null);

function stats(rows: TicketRow[]): Stat {
  const answered = rows
    .map((r) => ({ r, s: secs(r.first_in, r.first_out) }))
    .filter((x): x is { r: TicketRow; s: number } => x.s !== null);
  const frt = answered.map((x) => x.s);
  const ttr = rows.map((r) => secs(r.created_at, r.resolved_at)).filter((x): x is number => x !== null);
  return {
    tickets: rows.length,
    resolved: rows.filter((r) => r.resolved_at).length,
    open: rows.filter((r) => r.status === "open" || r.status === "pending").length,
    medianFirstResponse: median(frt),
    medianResolve: median(ttr),
    responded: frt.length,
    withinTarget: answered.filter(
      (x) => x.s <= (SLA_TARGET_HOURS[x.r.priority] ?? SLA_TARGET_HOURS.none) * 3600,
    ).length,
  };
}

const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Metrics for tickets that came in during the range.
 *
 * - First response: first inbound email → first reply from the team after it
 *   (from the portal or straight from Gmail). Tickets we started ourselves
 *   have no inbound first message, so they don't count here.
 * - Time to resolve: when the email came in → the first time the ticket was
 *   marked solved (by hand or by auto-solve). Tickets solved outside the app
 *   (no status event) have no resolve time.
 * - Closed tickets are left out altogether: closed means "not a request".
 * - Imported (backfilled) tickets are left out unless asked for: they were
 *   answered before the portal existed, so their timings would be noise.
 */
export async function buildReport(range: ReportRange, includeImported: boolean) {
  const days = RANGES.find((r) => r.value === range)?.days ?? 30;
  const from = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  // Closed = never a real request (notifications, spam), so it's not counted.
  const inRange = sql`tk.created_at >= ${from} and (${includeImported} or not tk.imported) and tk.status <> 'closed'`;

  const { rows } = await db.execute<TicketRow>(sql`
    with t as (
      select tk.id, tk.created_at, tk.status::text as status, tk.priority::text as priority, tk.team_id, tm.name as team_name
        from tickets tk
        left join teams tm on tm.id = tk.team_id
       where ${inRange}
    ),
    fi as (
      select m.ticket_id, min(m.sent_at) as at
        from messages m join t on t.id = m.ticket_id
       where m.direction = 'inbound'
       group by m.ticket_id
    ),
    fo as (
      select m.ticket_id, min(m.sent_at) as at
        from messages m join fi on fi.ticket_id = m.ticket_id
       where m.direction = 'outbound' and m.sent_at >= fi.at
       group by m.ticket_id
    ),
    res as (
      select e.ticket_id, min(e.created_at) as at
        from events e join t on t.id = e.ticket_id
       where e.kind = 'status' and e.data->>'to' = 'solved'
       group by e.ticket_id
    )
    select t.*, fi.at as first_in, fo.at as first_out, res.at as resolved_at
      from t
      left join fi on fi.ticket_id = t.id
      left join fo on fo.ticket_id = t.id
      left join res on res.ticket_id = t.id
  `);

  // The driver hands timestamps back as strings on raw queries.
  const tickets = rows.map((r) => ({
    ...r,
    created_at: new Date(r.created_at),
    first_in: r.first_in ? new Date(r.first_in) : null,
    first_out: r.first_out ? new Date(r.first_out) : null,
    resolved_at: r.resolved_at ? new Date(r.resolved_at) : null,
  }));
  const [tagRows, assigneeRows] = tickets.length
    ? await Promise.all([
        db.execute<{ ticket_id: string; id: string; name: string; color: string }>(sql`
          select tt.ticket_id, g.id, g.name, g.color
            from ticket_tags tt
            join tags g on g.id = tt.tag_id
            join tickets tk on tk.id = tt.ticket_id
           where ${inRange}
        `),
        db.execute<{ ticket_id: string; id: string; name: string }>(sql`
          select ta.ticket_id, a.id, a.name
            from ticket_assignees ta
            join agents a on a.id = ta.agent_id
            join tickets tk on tk.id = ta.ticket_id
           where ${inRange}
        `),
      ])
    : [{ rows: [] }, { rows: [] }];

  const byId = new Map(tickets.map((t) => [t.id, t]));
  function group<K extends { ticket_id: string; id: string; name: string; color?: string }>(
    list: K[],
  ): Breakdown[] {
    const groups = new Map<string, { label: string; color?: string; rows: TicketRow[] }>();
    for (const r of list) {
      const g = groups.get(r.id) ?? { label: r.name, color: r.color, rows: [] };
      const t = byId.get(r.ticket_id);
      if (t) g.rows.push(t);
      groups.set(r.id, g);
    }
    return [...groups.entries()]
      .map(([key, g]) => ({ key, label: g.label, color: g.color, ...stats(g.rows) }))
      .sort((a, b) => b.tickets - a.tickets);
  }

  const teamList: { ticket_id: string; id: string; name: string }[] = tickets.map((t) => ({
    ticket_id: t.id,
    id: t.team_id ?? "none",
    name: t.team_name ?? "No team",
  }));

  // Daily (or weekly, for long ranges) counts of tickets in vs resolved.
  const spanDays = days ?? Math.max(1, Math.ceil((Date.now() - Math.min(...tickets.map((t) => t.created_at.getTime()), Date.now())) / 86_400_000));
  const weekly = spanDays > 120;
  const bucket = (d: Date) => {
    if (!weekly) return dayKey.format(d);
    const monday = new Date(d);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return dayKey.format(monday);
  };
  const series = new Map<string, { created: number; resolved: number }>();
  const start = days ? from : new Date(Date.now() - spanDays * 86_400_000);
  for (let d = new Date(start); d <= new Date(); d = new Date(d.getTime() + (weekly ? 7 : 1) * 86_400_000)) {
    series.set(bucket(d), { created: 0, resolved: 0 });
  }
  for (const t of tickets) {
    const c = series.get(bucket(t.created_at));
    if (c) c.created++;
    if (t.resolved_at) {
      const r = series.get(bucket(t.resolved_at));
      if (r) r.resolved++;
    }
  }

  const importedCount = includeImported
    ? 0
    : Number(
        (
          await db.execute<{ n: number }>(
            sql`select count(*)::int as n from tickets where imported and status <> 'closed' and created_at >= ${from}`,
          )
        ).rows[0]?.n ?? 0,
      );

  return {
    from,
    weekly,
    overall: stats(tickets),
    byTeam: group(teamList),
    byTag: group(tagRows.rows),
    byAgent: group(assigneeRows.rows),
    volume: [...series.entries()].map(([date, v]) => ({ date, ...v })),
    importedCount,
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;
