import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agents, ticketAssignees, type Agent } from "@/db/schema";
import { env } from "@/lib/env";
import { sendNotice } from "@/lib/gmail/send";
import { NOTICE_TAG } from "@/lib/ticket-subject";
import { APP_NAME } from "@/lib/utils";

/**
 * Agent notifications by email: assigned to you, a requester replied on your
 * ticket, or you were @mentioned in a note. Never to the person who caused
 * it, and only to agents with notifications on. Failures are logged, never
 * thrown: a notice must not break the action that triggered it.
 */

type TicketRef = { id: string; number: number; subject: string };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function recipients(ids: string[], exceptId?: string | null) {
  const unique = [...new Set(ids)].filter((id) => id !== exceptId);
  if (!unique.length) return [];
  return db
    .select()
    .from(agents)
    .where(and(inArray(agents.id, unique), eq(agents.active, true), eq(agents.notifyEmail, true)));
}

async function send(to: Agent, subject: string, lead: string, tickets: TicketRef[], quote?: string) {
  const links = tickets
    .map(
      (t) =>
        `<li style="margin:4px 0"><a href="${env.appUrl}/tickets/${t.number}" style="color:#1d4ed8;text-decoration:none">#${t.number} ${esc(t.subject)}</a></li>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111827">
    <div style="max-width:560px;margin:0 auto;font-size:14px;line-height:1.5">
      <p style="margin:0 0 12px">${lead}</p>
      <ul style="margin:0 0 12px;padding-left:18px">${links}</ul>
      ${quote ? `<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #e5e7eb;color:#4b5563">${esc(quote)}</blockquote>` : ""}
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">${esc(APP_NAME)} notification. Turn these off from your avatar menu in the portal. Replies to this email aren't read.</p>
    </div></body></html>`;
  const text = [
    lead.replace(/<[^>]+>/g, ""),
    "",
    ...tickets.map((t) => `#${t.number} ${t.subject} ${env.appUrl}/tickets/${t.number}`),
    quote ? `\n> ${quote}` : "",
  ].join("\n");
  try {
    await sendNotice({ to: to.email, subject: `${NOTICE_TAG} ${subject}`, html, text });
  } catch (err) {
    console.error(`notify: failed to email ${to.email}`, err);
  }
}

/** "You were assigned …" (one email per person, even for a bulk assign). */
export async function notifyAssigned(tickets: TicketRef[], agentIds: string[], actor: Agent) {
  if (!tickets.length) return;
  for (const to of await recipients(agentIds, actor.id)) {
    const subject =
      tickets.length === 1
        ? `You were assigned #${tickets[0].number}: ${tickets[0].subject}`
        : `You were assigned ${tickets.length} tickets`;
    await send(
      to,
      subject,
      `<strong>${esc(actor.name)}</strong> assigned ${tickets.length === 1 ? "a ticket" : `${tickets.length} tickets`} to you:`,
      tickets,
    );
  }
}

/** A requester replied on a ticket: tell its assignees. */
export async function notifyReply(ticket: TicketRef, from: { email: string; name: string | null }, snippet: string) {
  const assigned = await db
    .select({ id: ticketAssignees.agentId })
    .from(ticketAssignees)
    .where(eq(ticketAssignees.ticketId, ticket.id));
  for (const to of await recipients(assigned.map((a) => a.id))) {
    if (to.email.toLowerCase() === from.email.toLowerCase()) continue;
    await send(
      to,
      `New reply on #${ticket.number}: ${ticket.subject}`,
      `<strong>${esc(from.name ?? from.email)}</strong> replied on a ticket assigned to you:`,
      [ticket],
      snippet,
    );
  }
}

/**
 * Agents @mentioned in a note: "@Kat", "@Kat Sakowitz" or "@ksakowitz"
 * (their email's local part), case-insensitive.
 */
export function mentionedAgents(text: string, all: Agent[]) {
  const lower = ` ${text.toLowerCase()} `;
  return all.filter((a) => {
    const names = [a.name, a.name.split(/\s+/)[0], a.email.split("@")[0]]
      .map((n) => n.toLowerCase().trim())
      .filter(Boolean);
    return names.some((n) => new RegExp(`(^|[\\s(])@${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(lower));
  });
}

export async function notifyMentions(ticket: TicketRef, noteText: string, author: Agent) {
  const all = await db.select().from(agents).where(eq(agents.active, true));
  const mentioned = mentionedAgents(noteText, all);
  for (const to of await recipients(mentioned.map((a) => a.id), author.id)) {
    await send(
      to,
      `${author.name} mentioned you on #${ticket.number}`,
      `<strong>${esc(author.name)}</strong> mentioned you in an internal note:`,
      [ticket],
      noteText.slice(0, 500),
    );
  }
}

/** The requester rated a solved ticket 👎 or left a comment: tell its assignees and the solver. */
export async function notifyCsat(
  ticket: TicketRef,
  agentIds: string[],
  from: string,
  rating: "good" | "bad",
  comment: string | null,
) {
  for (const to of await recipients(agentIds)) {
    await send(
      to,
      `${rating === "good" ? "👍" : "👎"} Feedback on #${ticket.number}: ${ticket.subject}`,
      `<strong>${esc(from)}</strong> rated a ticket you worked on ${rating === "good" ? "👍" : "👎"}${comment ? " and left a comment" : ""}:`,
      [ticket],
      comment?.slice(0, 1000),
    );
  }
}
