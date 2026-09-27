"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
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
import { listTickets, type TicketFilters } from "@/lib/queries";
import { photosFor } from "@/lib/people";
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

/* ------------------------------------------------------------- paging */

/** The next page of the ticket list, with photos for its people. */
export async function loadMoreTickets(filters: TicketFilters, offset: number) {
  const { agent } = await requireAgent();
  const rows = await listTickets(filters, agent, { offset });
  const photos = await photosFor([
    ...rows.map((r) => r.requesterEmail),
    ...rows.flatMap((r) => r.assignees.map((a) => a.email)),
  ]);
  return { rows, photos };
}

/* ------------------------------------------------------------------ bulk */

export type BulkOp =
  | { kind: "status"; status: TicketStatus }
  | { kind: "priority"; priority: TicketPriority }
  | { kind: "team"; teamId: string | null }
  | { kind: "assignee"; agentId: string; add: boolean }
  | { kind: "clearAssignees" }
  | { kind: "tag"; tagId: string; add: boolean }
  | { kind: "star"; add: boolean };

/**
 * Apply one change to many tickets. Only tickets that actually change get an
 * activity entry, so re-applying a tag to a mixed selection doesn't spam the
 * history of the ones that already had it.
 */
export async function bulkUpdate(ticketIds: string[], op: BulkOp): Promise<ActionState> {
  const { agent } = await requireAgent();
  const ids = [...new Set(ticketIds)].slice(0, 500);
  if (!ids.length) return { error: "Select some tickets first" };

  const now = new Date();
  let changed: string[] = [];
  let label = "";

  if (op.kind === "status" || op.kind === "priority") {
    const column = op.kind === "status" ? tickets.status : tickets.priority;
    const value = op.kind === "status" ? op.status : op.priority;
    if (!column.enumValues.includes(value as never)) return { error: `Unknown ${op.kind}` };
    const before = await db
      .select({ id: tickets.id, from: column })
      .from(tickets)
      .where(and(inArray(tickets.id, ids), ne(column, value as never)));
    changed = before.map((r) => r.id);
    if (changed.length) {
      await db
        .update(tickets)
        .set({ [op.kind]: value, updatedAt: now })
        .where(inArray(tickets.id, changed));
      await db.insert(events).values(
        before.map((r) => ({
          ticketId: r.id,
          actorAgentId: agent.id,
          kind: op.kind,
          data: { from: r.from, to: value },
        })),
      );
    }
    label = `${op.kind === "status" ? "Status" : "Priority"} set to ${op.kind === "priority" && value !== "none" ? value.toUpperCase() : value}`;
  } else if (op.kind === "team") {
    let name: string | null = null;
    if (op.teamId) {
      const [t] = await db.select().from(teams).where(eq(teams.id, op.teamId)).limit(1);
      if (!t) return { error: "Unknown team" };
      name = t.name;
    }
    const rows = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          inArray(tickets.id, ids),
          op.teamId
            ? sql`${tickets.teamId} is distinct from ${op.teamId}`
            : sql`${tickets.teamId} is not null`,
        ),
      );
    changed = rows.map((r) => r.id);
    if (changed.length) {
      await db.update(tickets).set({ teamId: op.teamId, updatedAt: now }).where(inArray(tickets.id, changed));
      await db.insert(events).values(
        changed.map((ticketId) => ({
          ticketId,
          actorAgentId: agent.id,
          kind: "team",
          data: { teamId: op.teamId, teamName: name },
        })),
      );
    }
    label = name ? `Moved to ${name}` : "Team cleared";
  } else if (op.kind === "assignee") {
    const [target] = await db.select().from(agents).where(eq(agents.id, op.agentId)).limit(1);
    if (!target) return { error: "Unknown agent" };
    const has = await db
      .select({ id: ticketAssignees.ticketId })
      .from(ticketAssignees)
      .where(and(inArray(ticketAssignees.ticketId, ids), eq(ticketAssignees.agentId, op.agentId)));
    const hasIds = new Set(has.map((r) => r.id));
    changed = ids.filter((id) => (op.add ? !hasIds.has(id) : hasIds.has(id)));
    if (changed.length) {
      if (op.add) {
        await db
          .insert(ticketAssignees)
          .values(changed.map((ticketId) => ({ ticketId, agentId: op.agentId })))
          .onConflictDoNothing();
      } else {
        await db
          .delete(ticketAssignees)
          .where(and(inArray(ticketAssignees.ticketId, changed), eq(ticketAssignees.agentId, op.agentId)));
      }
      await db.update(tickets).set({ updatedAt: now }).where(inArray(tickets.id, changed));
      await db.insert(events).values(
        changed.map((ticketId) => ({
          ticketId,
          actorAgentId: agent.id,
          kind: op.add ? "assigned" : "unassigned",
          data: { assigneeId: op.agentId, assigneeName: target.name },
        })),
      );
    }
    label = op.add ? `Assigned to ${target.name}` : `Unassigned ${target.name}`;
  } else if (op.kind === "clearAssignees") {
    const removed = await db
      .delete(ticketAssignees)
      .where(inArray(ticketAssignees.ticketId, ids))
      .returning({ id: ticketAssignees.ticketId });
    changed = [...new Set(removed.map((r) => r.id))];
    if (changed.length) {
      await db.update(tickets).set({ updatedAt: now }).where(inArray(tickets.id, changed));
      await db.insert(events).values(
        changed.map((ticketId) => ({
          ticketId,
          actorAgentId: agent.id,
          kind: "unassigned",
          data: { assigneeName: "everyone" },
        })),
      );
    }
    label = "Unassigned";
  } else if (op.kind === "tag") {
    const [tag] = await db.select().from(tags).where(eq(tags.id, op.tagId)).limit(1);
    if (!tag) return { error: "Unknown tag" };
    const has = await db
      .select({ id: ticketTags.ticketId })
      .from(ticketTags)
      .where(and(inArray(ticketTags.ticketId, ids), eq(ticketTags.tagId, op.tagId)));
    const hasIds = new Set(has.map((r) => r.id));
    changed = ids.filter((id) => (op.add ? !hasIds.has(id) : hasIds.has(id)));
    if (changed.length) {
      if (op.add) {
        await db
          .insert(ticketTags)
          .values(changed.map((ticketId) => ({ ticketId, tagId: op.tagId })))
          .onConflictDoNothing();
      } else {
        await db
          .delete(ticketTags)
          .where(and(inArray(ticketTags.ticketId, changed), eq(ticketTags.tagId, op.tagId)));
      }
      await db.update(tickets).set({ updatedAt: now }).where(inArray(tickets.id, changed));
      await db.insert(events).values(
        changed.map((ticketId) => ({
          ticketId,
          actorAgentId: agent.id,
          kind: op.add ? "tag_added" : "tag_removed",
          data: { tagName: tag.name },
        })),
      );
    }
    label = op.add ? `Tagged ${tag.name}` : `Removed ${tag.name}`;
  } else if (op.kind === "star") {
    if (op.add) {
      const existing = await db
        .select({ id: ticketStars.ticketId })
        .from(ticketStars)
        .where(and(eq(ticketStars.agentId, agent.id), inArray(ticketStars.ticketId, ids)));
      const known = existing.map((r) => r.id);
      const todo = known.length ? ids.filter((id) => !known.includes(id)) : ids;
      if (todo.length) {
        await db
          .insert(ticketStars)
          .values(todo.map((ticketId) => ({ agentId: agent.id, ticketId })))
          .onConflictDoNothing();
      }
      changed = todo;
    } else {
      const removed = await db
        .delete(ticketStars)
        .where(and(eq(ticketStars.agentId, agent.id), inArray(ticketStars.ticketId, ids)))
        .returning({ id: ticketStars.ticketId });
      changed = removed.map((r) => r.id);
    }
    label = op.add ? "Starred" : "Unstarred";
  } else {
    return { error: "Unknown change" };
  }

  revalidatePath("/tickets");
  const n = ids.length;
  return { ok: `${label} · ${n} ticket${n === 1 ? "" : "s"}${changed.length < n ? ` (${changed.length} changed)` : ""}` };
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
