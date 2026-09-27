import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  events,
  messages,
  tags,
  teams,
  ticketTags,
  tickets,
  agentTeams,
  attachments,
  ticketAssignees,
  type Agent,
} from "@/db/schema";

export type TicketView = "all" | "unassigned" | "mine" | "unsolved" | "starred";

export type TicketFilters = {
  view?: TicketView;
  team?: string;
  tag?: string;
  status?: string;
  q?: string;
};

function starredBy(me: Agent) {
  return sql<boolean>`exists (
    select 1 from ticket_stars ts
     where ts.ticket_id = ${tickets.id} and ts.agent_id = ${me.id}
  )`;
}

function hasAssignee() {
  return sql`exists (select 1 from ticket_assignees ta where ta.ticket_id = ${tickets.id})`;
}

function assignedTo(me: Agent) {
  return sql`exists (
    select 1 from ticket_assignees ta
     where ta.ticket_id = ${tickets.id} and ta.agent_id = ${me.id}
  )`;
}

const requesterText = sql`(coalesce(${tickets.requesterName}, '') || ' ' || ${tickets.requesterEmail})`;

/** How well `q` matches a ticket, 0–1, typo-tolerant (pg_trgm). */
function searchScore(q: string) {
  return sql<number>`greatest(
    word_similarity(${q}, ${tickets.subject}),
    word_similarity(${q}, ${requesterText})
  )`;
}

/**
 * Fuzzy search: close-enough spelling in the subject or requester, an exact
 * substring anywhere in those or in a message body, or a ticket number
 * ("1058" / "#1058").
 */
function searchMatch(q: string): SQL {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const number = q.match(/^#?(\d+)$/)?.[1];
  return sql`(
    ${searchScore(q)} > 0.4
    or ${tickets.subject} ilike ${like}
    or ${requesterText} ilike ${like}
    or exists (
      select 1 from messages m
       where m.ticket_id = ${tickets.id} and m.body_text ilike ${like}
    )
    ${number ? sql`or ${tickets.number} = ${Number(number)}` : sql``}
  )`;
}

function filterClauses(f: TicketFilters, me: Agent): SQL[] {
  const where: SQL[] = [];

  switch (f.view) {
    case "unassigned":
      where.push(sql`not ${hasAssignee()}`);
      where.push(inArray(tickets.status, ["open", "pending"]));
      break;
    case "mine":
      where.push(assignedTo(me));
      where.push(inArray(tickets.status, ["open", "pending"]));
      break;
    case "unsolved":
      where.push(inArray(tickets.status, ["open", "pending"]));
      break;
    case "starred":
      where.push(starredBy(me));
      break;
  }

  if (f.status && f.status !== "any") {
    where.push(sql`${tickets.status}::text = ${f.status}`);
  }
  if (f.team) where.push(sql`${teams.slug} = ${f.team}`);
  if (f.q?.trim()) where.push(searchMatch(f.q.trim()));
  if (f.tag) {
    where.push(
      sql`exists (
        select 1 from ticket_tags tt join tags tg on tg.id = tt.tag_id
         where tt.ticket_id = ${tickets.id} and tg.slug = ${f.tag}
      )`,
    );
  }

  return where;
}

export const PAGE_SIZE = 50;

/** One page of tickets; `offset` counts rows already shown. */
export async function listTickets(
  f: TicketFilters,
  me: Agent,
  page: { offset?: number; limit?: number } = {},
) {
  const where = filterClauses(f, me);
  const limit = Math.min(page.limit ?? PAGE_SIZE, 200);
  const offset = Math.max(page.offset ?? 0, 0);

  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      starred: starredBy(me),
      requesterEmail: tickets.requesterEmail,
      requesterName: tickets.requesterName,
      lastMessageAt: tickets.lastMessageAt,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      teamId: tickets.teamId,
      teamName: teams.name,
      teamSlug: teams.slug,
      messageCount: sql<number>`(
        select count(*)::int from messages m
         where m.ticket_id = ${tickets.id} and m.direction <> 'note'
      )`,
    })
    .from(tickets)
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .where(where.length ? and(...where) : undefined)
    // Searching ranks by match quality; browsing by most recent activity.
    .orderBy(
      ...(f.q?.trim() ? [desc(searchScore(f.q.trim()))] : []),
      desc(tickets.lastMessageAt),
      // Tie-break so pages never overlap or skip when timestamps match.
      desc(tickets.id),
    )
    .limit(limit)
    .offset(offset);

  const ids = rows.map((r) => r.id);
  const tagRows = ids.length
    ? await db
        .select({
          ticketId: ticketTags.ticketId,
          id: tags.id,
          name: tags.name,
          slug: tags.slug,
          color: tags.color,
        })
        .from(ticketTags)
        .innerJoin(tags, eq(tags.id, ticketTags.tagId))
        .where(inArray(ticketTags.ticketId, ids))
    : [];

  const byTicket = new Map<string, typeof tagRows>();
  for (const t of tagRows) {
    const list = byTicket.get(t.ticketId) ?? [];
    list.push(t);
    byTicket.set(t.ticketId, list);
  }

  const assigneesByTicket = await assigneesFor(ids);

  return rows.map((r) => ({
    ...r,
    tags: byTicket.get(r.id) ?? [],
    assignees: assigneesByTicket.get(r.id) ?? [],
  }));
}

export type AssigneeRef = { id: string; name: string; email: string };

async function assigneesFor(ticketIds: string[]) {
  const rows = ticketIds.length
    ? await db
        .select({
          ticketId: ticketAssignees.ticketId,
          id: agents.id,
          name: agents.name,
          email: agents.email,
        })
        .from(ticketAssignees)
        .innerJoin(agents, eq(agents.id, ticketAssignees.agentId))
        .where(inArray(ticketAssignees.ticketId, ticketIds))
        .orderBy(asc(ticketAssignees.createdAt))
    : [];
  const map = new Map<string, AssigneeRef[]>();
  for (const { ticketId, ...a } of rows) {
    const list = map.get(ticketId) ?? [];
    list.push(a);
    map.set(ticketId, list);
  }
  return map;
}

export async function ticketAssigneeIds(ticketId: string) {
  const map = await assigneesFor([ticketId]);
  return (map.get(ticketId) ?? []).map((a) => a.id);
}

/** How many tickets match, for the header count and "load more". */
export async function countTickets(f: TicketFilters, me: Agent) {
  const where = filterClauses(f, me);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .where(where.length ? and(...where) : undefined);
  return row?.n ?? 0;
}

export type TicketListItem = Awaited<ReturnType<typeof listTickets>>[number];

export async function viewCounts(me: Agent) {
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      unsolved: sql<number>`count(*) filter (where ${tickets.status} in ('open','pending'))::int`,
      unassigned: sql<number>`count(*) filter (where not ${hasAssignee()} and ${tickets.status} in ('open','pending'))::int`,
      mine: sql<number>`count(*) filter (where ${assignedTo(me)} and ${tickets.status} in ('open','pending'))::int`,
      starred: sql<number>`count(*) filter (where ${starredBy(me)})::int`,
    })
    .from(tickets);

  return row ?? { all: 0, unsolved: 0, unassigned: 0, mine: 0, starred: 0 };
}

export async function getTicketByNumber(number: number, me: Agent) {
  const [row] = await db
    .select({ ticket: tickets, starred: starredBy(me) })
    .from(tickets)
    .where(eq(tickets.number, number))
    .limit(1);
  return row ? { ...row.ticket, starred: row.starred } : null;
}

/** Tickets either side of `number` in the default queue, for j/k on the ticket page. */
export async function neighbours(ticket: { lastMessageAt: Date; id: string }) {
  const unsolved = inArray(tickets.status, ["open", "pending"]);
  const [newer] = await db
    .select({ number: tickets.number })
    .from(tickets)
    .where(and(unsolved, sql`(${tickets.lastMessageAt}, ${tickets.id}) > (${ticket.lastMessageAt}, ${ticket.id})`))
    .orderBy(asc(tickets.lastMessageAt), asc(tickets.id))
    .limit(1);
  const [older] = await db
    .select({ number: tickets.number })
    .from(tickets)
    .where(and(unsolved, sql`(${tickets.lastMessageAt}, ${tickets.id}) < (${ticket.lastMessageAt}, ${ticket.id})`))
    .orderBy(desc(tickets.lastMessageAt), desc(tickets.id))
    .limit(1);
  return { newer: newer?.number ?? null, older: older?.number ?? null };
}

export async function getThread(ticketId: string) {
  const rows = await db
    .select({
      message: messages,
      authorName: agents.name,
      authorEmail: agents.email,
    })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.authorAgentId))
    .where(eq(messages.ticketId, ticketId))
    .orderBy(asc(messages.sentAt));

  const ids = rows.map((r) => r.message.id);
  const atts = ids.length
    ? await db
        .select()
        .from(attachments)
        .where(inArray(attachments.messageId, ids))
    : [];

  const byMessage = new Map<string, typeof atts>();
  for (const a of atts) {
    const list = byMessage.get(a.messageId) ?? [];
    list.push(a);
    byMessage.set(a.messageId, list);
  }

  const activity = await db
    .select({ event: events, actorName: agents.name })
    .from(events)
    .leftJoin(agents, eq(agents.id, events.actorAgentId))
    .where(eq(events.ticketId, ticketId))
    .orderBy(asc(events.createdAt));

  return {
    messages: rows.map((r) => ({
      ...r.message,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      attachments: byMessage.get(r.message.id) ?? [],
    })),
    events: activity.map((a) => ({ ...a.event, actorName: a.actorName })),
  };
}

/**
 * Reply-all defaults for the composer: the requester in To, and in Cc the
 * group plus the sender and recipients of the latest email, minus our own
 * addresses.
 */
export function replyRecipients(
  ticket: { requesterEmail: string },
  thread: { direction: string; fromEmail: string; toEmails: string[]; ccEmails: string[] }[],
  own: { group: string; mailbox: string },
) {
  const lastEmail = [...thread].reverse().find((m) => m.direction !== "note");
  const requester = ticket.requesterEmail.toLowerCase();
  const skip = new Set([requester, own.group.toLowerCase(), own.mailbox.toLowerCase()]);
  const others = [
    ...(lastEmail ? [lastEmail.fromEmail] : []),
    ...(lastEmail?.toEmails ?? []),
    ...(lastEmail?.ccEmails ?? []),
  ]
    .map((e) => e.toLowerCase())
    .filter((e) => !skip.has(e));

  return {
    to: [requester],
    cc: [own.group.toLowerCase(), ...new Set(others)],
  };
}

export type ThreadMessage = Awaited<ReturnType<typeof getThread>>["messages"][number];
export type ThreadEvent = Awaited<ReturnType<typeof getThread>>["events"][number];

export async function listAgents(activeOnly = false) {
  return db
    .select()
    .from(agents)
    .where(activeOnly ? eq(agents.active, true) : undefined)
    .orderBy(asc(agents.name));
}

export async function listTeams() {
  return db.select().from(teams).orderBy(asc(teams.name));
}

export async function listTags() {
  return db.select().from(tags).orderBy(asc(tags.name));
}

export async function ticketTagIds(ticketId: string) {
  const rows = await db
    .select({ tagId: ticketTags.tagId })
    .from(ticketTags)
    .where(eq(ticketTags.ticketId, ticketId));
  return rows.map((r) => r.tagId);
}

export async function agentTeamRows() {
  return db.select().from(agentTeams);
}

/** People who've written in recently, for To/Cc suggestions when composing. */
export async function recentRequesters(limit = 300) {
  return db
    .select({
      email: tickets.requesterEmail,
      name: sql<string | null>`max(${tickets.requesterName})`,
    })
    .from(tickets)
    .groupBy(tickets.requesterEmail)
    .orderBy(desc(sql`max(${tickets.lastMessageAt})`))
    .limit(limit);
}
