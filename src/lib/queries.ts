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
  type Agent,
} from "@/db/schema";

export type TicketView = "all" | "unassigned" | "mine" | "unsolved";

export type TicketFilters = {
  view?: TicketView;
  team?: string;
  tag?: string;
  status?: string;
  q?: string;
};

function filterClauses(f: TicketFilters, me: Agent): SQL[] {
  const where: SQL[] = [];

  switch (f.view) {
    case "unassigned":
      where.push(sql`${tickets.assigneeId} is null`);
      where.push(inArray(tickets.status, ["open", "pending"]));
      break;
    case "mine":
      where.push(eq(tickets.assigneeId, me.id));
      where.push(inArray(tickets.status, ["open", "pending"]));
      break;
    case "unsolved":
      where.push(inArray(tickets.status, ["open", "pending"]));
      break;
  }

  if (f.status && f.status !== "any") {
    where.push(sql`${tickets.status}::text = ${f.status}`);
  }
  if (f.team) where.push(sql`${teams.slug} = ${f.team}`);
  if (f.q) {
    const like = `%${f.q.toLowerCase()}%`;
    where.push(
      sql`(lower(${tickets.subject}) like ${like} or lower(${tickets.requesterEmail}) like ${like})`,
    );
  }
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

export async function listTickets(f: TicketFilters, me: Agent) {
  const where = filterClauses(f, me);

  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      requesterEmail: tickets.requesterEmail,
      requesterName: tickets.requesterName,
      lastMessageAt: tickets.lastMessageAt,
      updatedAt: tickets.updatedAt,
      assigneeName: agents.name,
      assigneeEmail: agents.email,
      teamName: teams.name,
      teamSlug: teams.slug,
      messageCount: sql<number>`(
        select count(*)::int from messages m
         where m.ticket_id = ${tickets.id} and m.direction <> 'note'
      )`,
    })
    .from(tickets)
    .leftJoin(agents, eq(agents.id, tickets.assigneeId))
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(tickets.lastMessageAt))
    .limit(200);

  const ids = rows.map((r) => r.id);
  const tagRows = ids.length
    ? await db
        .select({
          ticketId: ticketTags.ticketId,
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

  return rows.map((r) => ({ ...r, tags: byTicket.get(r.id) ?? [] }));
}

export type TicketListItem = Awaited<ReturnType<typeof listTickets>>[number];

export async function viewCounts(me: Agent) {
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      unsolved: sql<number>`count(*) filter (where ${tickets.status} in ('open','pending'))::int`,
      unassigned: sql<number>`count(*) filter (where ${tickets.assigneeId} is null and ${tickets.status} in ('open','pending'))::int`,
      mine: sql<number>`count(*) filter (where ${tickets.assigneeId} = ${me.id} and ${tickets.status} in ('open','pending'))::int`,
    })
    .from(tickets);

  return row ?? { all: 0, unsolved: 0, unassigned: 0, mine: 0 };
}

export async function getTicketByNumber(number: number) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.number, number))
    .limit(1);
  return ticket ?? null;
}

export async function getThread(ticketId: string) {
  const rows = await db
    .select({
      message: messages,
      authorName: agents.name,
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
      attachments: byMessage.get(r.message.id) ?? [],
    })),
    events: activity.map((a) => ({ ...a.event, actorName: a.actorName })),
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
