"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  events,
  messages,
  tags,
  teams,
  ticketAssignees,
  ticketStars,
  ticketTags,
  tickets,
  type TicketPriority,
  type TicketStatus,
} from "@/db/schema";
import { requireAgent } from "@/lib/auth";
import { sendReply } from "@/lib/gmail/send";

export type ActionState = { ok?: string; error?: string };

function refresh(number: number) {
  revalidatePath(`/tickets/${number}`);
  revalidatePath("/tickets");
}

async function ticketOr404(id: string) {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!t) throw new Error("Ticket not found");
  return t;
}

async function touch(id: string) {
  await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, id));
}

/*
 * Property changes take plain arguments rather than FormData so the pickers
 * and keyboard shortcuts can call them directly.
 */

/* ---------------------------------------------------------------- assign */

/** Adds or removes one assignee; a ticket can have several. */
export async function toggleAssignee(
  ticketId: string,
  agentId: string,
  mode: "toggle" | "add" = "toggle",
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticket = await ticketOr404(ticketId);
  const [target] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!target) return { error: "Unknown agent" };

  const where = and(eq(ticketAssignees.ticketId, ticketId), eq(ticketAssignees.agentId, agentId));
  const [existing] = await db.select().from(ticketAssignees).where(where).limit(1);
  if (existing && mode === "add") return { ok: `Already assigned to ${target.name}` };

  if (existing) await db.delete(ticketAssignees).where(where);
  else await db.insert(ticketAssignees).values({ ticketId, agentId }).onConflictDoNothing();

  await touch(ticketId);
  await db.insert(events).values({
    ticketId,
    actorAgentId: agent.id,
    kind: existing ? "unassigned" : "assigned",
    data: { assigneeId: agentId, assigneeName: target.name },
  });

  refresh(ticket.number);
  return { ok: existing ? `Unassigned ${target.name}` : `Assigned to ${target.name}` };
}

export async function clearAssignees(ticketId: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticket = await ticketOr404(ticketId);
  const removed = await db
    .delete(ticketAssignees)
    .where(eq(ticketAssignees.ticketId, ticketId))
    .returning();
  if (!removed.length) return { ok: "No change" };

  await touch(ticketId);
  await db.insert(events).values({
    ticketId,
    actorAgentId: agent.id,
    kind: "unassigned",
    data: { assigneeName: "everyone" },
  });

  refresh(ticket.number);
  return { ok: "Unassigned" };
}

export async function assignToMe(ticketId: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  return toggleAssignee(ticketId, agent.id, "add");
}

/* ---------------------------------------------------------------- status */

export async function setStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!tickets.status.enumValues.includes(status)) return { error: "Unknown status" };

  const ticket = await ticketOr404(ticketId);
  if (ticket.status === status) return { ok: "No change" };

  await db.update(tickets).set({ status, updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await db.insert(events).values({
    ticketId,
    actorAgentId: agent.id,
    kind: "status",
    data: { from: ticket.status, to: status },
  });

  refresh(ticket.number);
  return { ok: `Status set to ${status}` };
}

/* -------------------------------------------------------------- priority */

export async function setPriority(
  ticketId: string,
  priority: TicketPriority,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!tickets.priority.enumValues.includes(priority)) return { error: "Unknown priority" };

  const ticket = await ticketOr404(ticketId);
  if (ticket.priority === priority) return { ok: "No change" };

  await db.update(tickets).set({ priority, updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await db.insert(events).values({
    ticketId,
    actorAgentId: agent.id,
    kind: "priority",
    data: { from: ticket.priority, to: priority },
  });

  refresh(ticket.number);
  return { ok: `Priority set to ${priority}` };
}

/* ------------------------------------------------------------------ team */

export async function setTeam(
  ticketId: string,
  teamId: string | null,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticket = await ticketOr404(ticketId);
  if (ticket.teamId === teamId) return { ok: "No change" };

  let name: string | null = null;
  if (teamId) {
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return { error: "Unknown team" };
    name = t.name;
  }

  await db.update(tickets).set({ teamId, updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await db.insert(events).values({
    ticketId,
    actorAgentId: agent.id,
    kind: "team",
    data: { teamId, teamName: name },
  });

  refresh(ticket.number);
  return { ok: name ? `Moved to ${name}` : "Team cleared" };
}

/* ------------------------------------------------------------------- tags */

export async function toggleTag(ticketId: string, tagId: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticket = await ticketOr404(ticketId);
  const [tag] = await db.select().from(tags).where(eq(tags.id, tagId)).limit(1);
  if (!tag) return { error: "Unknown tag" };

  const existing = await db
    .select()
    .from(ticketTags)
    .where(and(eq(ticketTags.ticketId, ticketId), eq(ticketTags.tagId, tagId)))
    .limit(1);

  if (existing.length) {
    await db
      .delete(ticketTags)
      .where(and(eq(ticketTags.ticketId, ticketId), eq(ticketTags.tagId, tagId)));
    await db.insert(events).values({
      ticketId,
      actorAgentId: agent.id,
      kind: "tag_removed",
      data: { tagName: tag.name },
    });
  } else {
    await db.insert(ticketTags).values({ ticketId, tagId }).onConflictDoNothing();
    await db.insert(events).values({
      ticketId,
      actorAgentId: agent.id,
      kind: "tag_added",
      data: { tagName: tag.name },
    });
  }

  await touch(ticketId);
  refresh(ticket.number);
  return { ok: existing.length ? `Removed ${tag.name}` : `Added ${tag.name}` };
}

/* ------------------------------------------------------------------ star */

/** Stars are per agent, so this doesn't touch the ticket or its activity log. */
export async function toggleStar(ticketId: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticket = await ticketOr404(ticketId);
  const where = and(eq(ticketStars.agentId, agent.id), eq(ticketStars.ticketId, ticketId));

  const removed = await db.delete(ticketStars).where(where).returning();
  if (!removed.length) {
    await db.insert(ticketStars).values({ agentId: agent.id, ticketId }).onConflictDoNothing();
  }

  refresh(ticket.number);
  return { ok: removed.length ? "Unstarred" : "Starred" };
}

/* ----------------------------------------------------------------- reply */

export async function replyToTicket(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const bodyText = String(form.get("body") ?? "").trim();
  const bodyHtml = String(form.get("bodyHtml") ?? "").trim() || null;
  if (!bodyText) return { error: "Write something first" };

  let to: string[], cc: string[], bcc: string[];
  try {
    to = addresses(form.get("to"));
    cc = addresses(form.get("cc"));
    bcc = addresses(form.get("bcc"));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (!to.length) return { error: "Add at least one recipient" };

  const ticket = await ticketOr404(ticketId);

  try {
    await sendReply({ ticketId, agent, to, cc, bcc, bodyText, bodyHtml });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Send failed: ${message}` };
  }

  refresh(ticket.number);
  return { ok: "Reply sent" };
}

/** A JSON array of addresses from the composer, validated and de-duplicated. */
function addresses(raw: FormDataEntryValue | null): string[] {
  if (!raw) return [];
  const list = JSON.parse(String(raw)) as unknown;
  if (!Array.isArray(list)) throw new Error("Bad recipient list");
  const out = new Set<string>();
  for (const v of list) {
    const e = String(v).trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e)) throw new Error(`Not an email address: ${e}`);
    out.add(e);
  }
  return [...out];
}

/* ------------------------------------------------------------------ note */

export async function addNote(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const body = String(form.get("body") ?? "").trim();
  const bodyHtml = String(form.get("bodyHtml") ?? "").trim() || null;
  if (!body) return { error: "Write something first" };

  const ticket = await ticketOr404(ticketId);
  const now = new Date();

  await db.insert(messages).values({
    ticketId,
    direction: "note",
    fromEmail: agent.email,
    fromName: agent.name,
    bodyText: body,
    // Notes are only ever shown inside the sandboxed message frame.
    bodyHtml,
    authorAgentId: agent.id,
    sentAt: now,
  });
  await db.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, ticketId));

  refresh(ticket.number);
  return { ok: "Note added" };
}
