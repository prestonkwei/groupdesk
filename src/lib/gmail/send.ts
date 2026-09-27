import "server-only";
import { createMimeMessage } from "mimetext";
import { desc, eq, isNotNull, and } from "drizzle-orm";
import { db } from "@/db";
import { messages, tickets, type Agent } from "@/db/schema";
import { env } from "@/lib/env";
import { taggedSubject, ticketNumberFromSubject } from "@/lib/ticket-subject";
import { gmailFor } from "./client";

export type SentReply = {
  gmailMessageId: string;
  rfcMessageId: string | null;
  messageRowId: string;
};

/**
 * Send a reply on a ticket's Gmail thread and record it as an outbound message.
 *
 * The RFC Message-ID we store here is what dedupes the copy that comes back to
 * us through the group a moment later (see ingest.ts).
 */
export async function sendReply(args: {
  ticketId: string;
  agent: Agent;
  to: string[];
  cc: string[];
  bcc: string[];
  bodyText: string;
  /** Rich-text body from the composer; plain text is always sent alongside. */
  bodyHtml: string | null;
}): Promise<SentReply> {
  if (!args.to.length) throw new Error("Add at least one recipient");

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, args.ticketId))
    .limit(1);
  if (!ticket) throw new Error("Ticket not found");

  /*
   * Gmail titles a conversation after its first message, so a reply threaded
   * onto the requester's original email keeps their untagged subject on
   * screen. Instead, the first reply starts a fresh conversation titled
   * "[TICKET: #n] …", and later replies thread onto the latest message in that
   * tagged conversation. Replies to it come back with the tag (and our
   * Message-IDs in References), so ingest still files them on this ticket.
   */
  const candidates = await db
    .select()
    .from(messages)
    .where(and(eq(messages.ticketId, ticket.id), isNotNull(messages.rfcMessageId)))
    .orderBy(desc(messages.sentAt))
    .limit(50);
  const last =
    candidates.find((m) => ticketNumberFromSubject(m.subject) === ticket.number) ?? null;

  const { client } = await gmailFor();

  // Keep our own mailbox's copy in the same tagged conversation too.
  let threadId: string | undefined;
  if (last?.gmailMessageId) {
    const { data } = await client.users.messages
      .get({ userId: "me", id: last.gmailMessageId, format: "minimal" })
      .catch(() => ({ data: { threadId: undefined as string | null | undefined } }));
    threadId = data.threadId ?? undefined;
  }

  const subject = taggedSubject(ticket.number, ticket.subject);

  // Replies come from the team address with the agent's name on it. Gmail only
  // honours this From when the group address is a verified "Send mail as"
  // alias of the connected mailbox; otherwise it falls back to the mailbox.
  const from = env.groupEmail;

  const msg = createMimeMessage();
  msg.setSender({ name: args.agent.name, addr: from });
  msg.setTo(args.to);
  if (args.cc.length) msg.setCc(args.cc);
  if (args.bcc.length) msg.setBcc(args.bcc);
  msg.setSubject(subject);

  const references = [
    ...(last?.references ?? []),
    ...(last?.rfcMessageId ? [last.rfcMessageId] : []),
  ].slice(-20);

  if (last?.rfcMessageId) {
    msg.setHeader("In-Reply-To", last.rfcMessageId);
  }
  if (references.length) {
    msg.setHeader("References", references.join(" "));
  }

  const body = `${args.bodyText.trim()}\n\n--\n${args.agent.name}\nhelpdesk\n`;
  msg.addMessage({ contentType: "text/plain", encoding: "base64", data: base64Lines(body) });

  const html = args.bodyHtml
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2328">${cleanHtml(args.bodyHtml)}` +
      `<p style="margin-top:16px;color:#6b7280">--<br>${escapeHtml(args.agent.name)}<br>helpdesk</p></div>`
    : null;
  if (html) msg.addMessage({ contentType: "text/html", encoding: "base64", data: base64Lines(html) });

  const raw = Buffer.from(msg.asRaw()).toString("base64url");

  const { data: sent } = await client.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId,
    },
  });

  if (!sent.id) throw new Error("messages.send returned no id");

  // Read back the assigned Message-ID header so the echo dedupes.
  const { data: meta } = await client.users.messages.get({
    userId: "me",
    id: sent.id,
    format: "metadata",
    metadataHeaders: ["Message-ID", "Message-Id"],
  });

  const rfcMessageId =
    meta.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")
      ?.value ?? null;

  const now = new Date();

  const [row] = await db
    .insert(messages)
    .values({
      ticketId: ticket.id,
      direction: "outbound",
      gmailMessageId: sent.id,
      rfcMessageId,
      inReplyTo: last?.rfcMessageId ?? null,
      references,
      fromEmail: from,
      fromName: args.agent.name,
      toEmails: args.to,
      ccEmails: args.cc,
      bccEmails: args.bcc,
      subject,
      bodyText: body,
      bodyHtml: html,
      authorAgentId: args.agent.id,
      sentAt: now,
    })
    .returning({ id: messages.id });

  await db
    .update(tickets)
    .set({
      lastMessageAt: now,
      updatedAt: now,
      gmailThreadId: ticket.gmailThreadId ?? sent.threadId ?? null,
      ...(ticket.status === "open" ? { status: "pending" as const } : {}),
    })
    .where(eq(tickets.id, ticket.id));

  return { gmailMessageId: sent.id, rfcMessageId, messageRowId: row.id };
}

/** Base64 in 76-character lines, so non-ASCII text and long HTML lines survive transit. */
function base64Lines(s: string) {
  return (Buffer.from(s, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The composer only produces simple formatting, but the action accepts any
 * string, so drop anything active before it goes out or into the database.
 */
function cleanHtml(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|link|meta)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*/gi, "$1=$2#");
}
