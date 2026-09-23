"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, events, messages, tags, teams, ticketTags, tickets } from "@/db/schema";
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

/* ---------------------------------------------------------------- assign */

export async function assignTicket(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const raw = String(form.get("assigneeId") ?? "");
  const assigneeId = raw && raw !== "none" ? raw : null;

  const ticket = await ticketOr404(ticketId);
  if (ticket.assigneeId === assigneeId) return { ok: "No change" };

  let name: string | null = null;
  if (assigneeId) {
    const [a] = await db.select().from(agents).where(eq(agents.id, assigneeId)).limit(1);
    if (!a) return { error: "Unknown agent" };
    name = a.name;
  }

  await db.update(tickets).set({ assigneeId, updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await db.insert(events).values({
    ticketId,
    actorAgentId: agent.id,
    kind: assigneeId ? "assigned" : "unassigned",
    data: { assigneeId, assigneeName: name },
  });

  refresh(ticket.number);
  return { ok: assigneeId ? `Assigned to ${name}` : "Unassigned" };
}

/* ---------------------------------------------------------------- status */

export async function setStatus(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const status = String(form.get("status")) as (typeof tickets.status.enumValues)[number];

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

/* ------------------------------------------------------------------ team */

export async function setTeam(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const raw = String(form.get("teamId") ?? "");
  const teamId = raw && raw !== "none" ? raw : null;

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

export async function toggleTag(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const tagId = String(form.get("tagId"));

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

/* ----------------------------------------------------------------- reply */

export async function replyToTicket(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Write something first" };

  const ticket = await ticketOr404(ticketId);

  try {
    await sendReply({ ticketId, agent, bodyText: body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Send failed: ${message}` };
  }

  refresh(ticket.number);
  return { ok: "Reply sent" };
}

/* ------------------------------------------------------------------ note */

export async function addNote(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ticketId = String(form.get("ticketId"));
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Write something first" };

  const ticket = await ticketOr404(ticketId);
  const now = new Date();

  await db.insert(messages).values({
    ticketId,
    direction: "note",
    fromEmail: agent.email,
    fromName: agent.name,
    bodyText: body,
    authorAgentId: agent.id,
    sentAt: now,
  });
  await db.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, ticketId));

  refresh(ticket.number);
  return { ok: "Note added" };
}
