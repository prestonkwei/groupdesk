import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, events, ticketAssignees, tickets, type Agent } from "@/db/schema";
import { env } from "@/lib/env";
import { sendNotice } from "@/lib/gmail/send";
import { DIGEST_TAG } from "@/lib/ticket-subject";
import { firstNameOf } from "@/lib/template-vars";
import { TIME_ZONE, shortDate } from "@/lib/utils";

const DAY = 86_400_000;
const LIST_LIMIT = 10;

type Row = {
  number: number;
  subject: string;
  status: string;
  priority: string;
  createdAt: Date;
  requester: string;
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function age(d: Date) {
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  if (days < 1) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** Same thresholds as the age pill in the portal: green < 3d, yellow 3–5d, red 5d+. */
function ageColor(d: Date) {
  const days = (Date.now() - d.getTime()) / DAY;
  return days >= 5 ? "#b42318" : days >= 3 ? "#b54708" : "#067647";
}

async function digestFor(agent: Agent) {
  const mine = await db
    .select({
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      requester: sql<string>`coalesce(${tickets.requesterName}, ${tickets.requesterEmail})`,
    })
    .from(tickets)
    .innerJoin(ticketAssignees, eq(ticketAssignees.ticketId, tickets.id))
    .where(and(eq(ticketAssignees.agentId, agent.id), inArray(tickets.status, ["open", "pending"])))
    .orderBy(asc(tickets.createdAt));

  const weekAgo = new Date(Date.now() - 7 * DAY);
  const [{ solved }] = await db
    .select({ solved: sql<number>`count(distinct ${events.ticketId})::int` })
    .from(events)
    .innerJoin(ticketAssignees, eq(ticketAssignees.ticketId, events.ticketId))
    .where(
      and(
        eq(ticketAssignees.agentId, agent.id),
        eq(events.kind, "status"),
        sql`${events.data}->>'to' = 'solved'`,
        gt(events.createdAt, weekAgo),
      ),
    );

  const [{ unassigned }] = await db
    .select({ unassigned: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        inArray(tickets.status, ["open", "pending"]),
        sql`not exists (select 1 from ticket_assignees ta where ta.ticket_id = ${tickets.id})`,
      ),
    );

  return { mine: mine as Row[], solved, unassigned };
}

function render(agent: Agent, data: Awaited<ReturnType<typeof digestFor>>) {
  const base = env.appUrl;
  const open = data.mine.filter((t) => t.status === "open").length;
  const pending = data.mine.filter((t) => t.status === "pending").length;
  const oldest = data.mine[0];
  const first = firstNameOf(agent.name) || agent.name;
  const week = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE });

  const subject = `${DIGEST_TAG} ${open} open, ${pending} pending · week of ${week}`;
  const link = (n: number) => `${base}/tickets/${n}`;

  const stat = (label: string, value: number | string, href?: string) => `
    <td style="padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;width:25%">
      <div style="font-size:12px;color:#6b7280">${label}</div>
      <div style="font-size:24px;font-weight:600;color:#111827">${href ? `<a href="${href}" style="color:#111827;text-decoration:none">${value}</a>` : value}</div>
    </td>`;

  const rows = data.mine
    .slice(0, LIST_LIMIT)
    .map(
      (t) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;vertical-align:top">
          <a href="${link(t.number)}" style="color:#1d4ed8;text-decoration:none;font-weight:500">#${t.number} ${esc(t.subject)}</a>
          <div style="font-size:12px;color:#6b7280">${esc(t.requester)} · ${t.status}${t.priority !== "none" ? ` · ${t.priority.toUpperCase()}` : ""}</div>
        </td>
        <td style="padding:8px 0 8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;vertical-align:top;font-size:12px;color:${ageColor(t.createdAt)}">
          ${age(t.createdAt)}
        </td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <div style="max-width:600px;margin:0 auto">
    <p style="font-size:16px;margin:0 0 4px">Hi ${esc(first)},</p>
    <p style="font-size:14px;color:#4b5563;margin:0 0 20px">Here's where your helpdesk tickets stand this Friday.</p>
    <table role="presentation" cellspacing="8" cellpadding="0" style="width:100%;margin:0 -8px 12px"><tr>
      ${stat("Assigned &amp; unsolved", data.mine.length, `${base}/tickets?view=mine`)}
      ${stat("Open", open)}
      ${stat("Pending", pending)}
      ${stat("Solved this week", data.solved)}
    </tr></table>
    ${
      oldest
        ? `<div style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${ageColor(oldest.createdAt)};background:#fafafa">
            <div style="font-size:12px;color:#6b7280">Open the longest (${age(oldest.createdAt)}, since ${shortDate(oldest.createdAt)})</div>
            <a href="${link(oldest.number)}" style="font-size:15px;color:#1d4ed8;text-decoration:none;font-weight:600">#${oldest.number} ${esc(oldest.subject)}</a>
          </div>`
        : `<p style="font-size:14px;margin:0 0 20px">Nothing assigned to you is waiting. Nice.</p>`
    }
    ${
      rows
        ? `<h2 style="font-size:14px;margin:0 0 4px">Your unsolved tickets, oldest first</h2>
           <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
           ${data.mine.length > LIST_LIMIT ? `<p style="font-size:13px;margin:8px 0 0"><a href="${base}/tickets?view=mine" style="color:#1d4ed8">See all ${data.mine.length}</a></p>` : ""}`
        : ""
    }
    <p style="font-size:13px;color:#4b5563;margin:24px 0 0">
      Team-wide, <a href="${base}/tickets?view=unassigned" style="color:#1d4ed8">${data.unassigned} unsolved ticket${data.unassigned === 1 ? " has" : "s have"} no one assigned</a>.
    </p>
    <p style="font-size:12px;color:#9ca3af;margin:24px 0 0">Weekly digest from Tickets, every Friday at 4pm. Replies to this email aren't read.</p>
  </div></body></html>`;

  const text = [
    `Hi ${first},`,
    "",
    `Assigned to you and unsolved: ${data.mine.length} (${open} open, ${pending} pending). Solved this week: ${data.solved}.`,
    oldest ? `Open the longest: #${oldest.number} ${oldest.subject} (${age(oldest.createdAt)}) ${link(oldest.number)}` : "Nothing assigned to you is waiting.",
    "",
    ...data.mine.slice(0, LIST_LIMIT).map((t) => `#${t.number} ${t.subject} (${t.status}, ${age(t.createdAt)}) ${link(t.number)}`),
    data.mine.length > LIST_LIMIT ? `See all: ${base}/tickets?view=mine` : "",
    "",
    `Team-wide, ${data.unassigned} unsolved tickets have no one assigned: ${base}/tickets?view=unassigned`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Email every active agent their weekly digest. Agents who got one in the
 * last 3 days are skipped (so a retried cron can't double-send) unless
 * `force`. `onlyAgentId` sends a single preview without marking it sent.
 */
export async function sendWeeklyDigests(options: { force?: boolean; onlyAgentId?: string } = {}) {
  const recipients = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.active, true),
        options.onlyAgentId ? eq(agents.id, options.onlyAgentId) : undefined,
        options.force
          ? undefined
          : sql`(${agents.lastDigestAt} is null or ${agents.lastDigestAt} < now() - interval '3 days')`,
      ),
    );

  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const agent of recipients) {
    try {
      const { subject, html, text } = render(agent, await digestFor(agent));
      await sendNotice({ to: agent.email, subject, html, text });
      if (!options.onlyAgentId) {
        await db.update(agents).set({ lastDigestAt: new Date() }).where(eq(agents.id, agent.id));
      }
      results.push({ email: agent.email, ok: true });
    } catch (err) {
      results.push({ email: agent.email, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** True during 4pm on a Friday in the school's time zone (DST-proof cron gate). */
export function isDigestHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Fri" && hour === 16;
}
