import "server-only";
import { createMimeMessage } from "mimetext";
import { desc, eq, isNotNull, and } from "drizzle-orm";
import { db } from "@/db";
import { messages, tickets, type Agent } from "@/db/schema";
import { env } from "@/lib/env";
import { taggedSubject } from "@/lib/ticket-subject";
import { TEAM_NAME, TIME_ZONE } from "@/lib/utils";
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

  const { client } = await gmailFor();
  const { last, threadId, references } = await threadingFor(client, ticket);

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

  if (last?.rfcMessageId) {
    msg.setHeader("In-Reply-To", last.rfcMessageId);
  }
  if (references.length) {
    msg.setHeader("References", references.join(" "));
  }

  const body = `${args.bodyText.trim()}\n\n--\n${args.agent.name}\n${TEAM_NAME}\n`;
  const quote = last ? quoteOf(last) : null;
  msg.addMessage({
    contentType: "text/plain",
    encoding: "base64",
    data: base64Lines(quote ? `${body}\n${quote.text}` : body),
  });

  // Always send HTML so the quoted history renders (and collapses) like a
  // normal Gmail reply. The portal hides .gmail_quote the same way.
  const content = args.bodyHtml
    ? emailHtml(args.bodyHtml)
    : escapeHtml(args.bodyText.trim()).replace(/\n/g, "<br>");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#1f2328">${content}` +
    `<p style="margin-top:16px;color:#6b7280">--<br>${escapeHtml(args.agent.name)}<br>${TEAM_NAME}</p></div>` +
    (quote?.html ?? "");
  msg.addMessage({ contentType: "text/html", encoding: "base64", data: base64Lines(html) });

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

type QuotedMessage = Pick<
  typeof messages.$inferSelect,
  "fromName" | "fromEmail" | "sentAt" | "bodyText" | "bodyHtml"
>;

const quoteDate = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "On <date>, <sender> wrote:" plus the previous email, as Gmail quotes it. */
function quoteOf(m: QuotedMessage) {
  const who = m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
  const attribution = `On ${quoteDate.format(m.sentAt)}, ${who} wrote:`;
  const text = `${attribution}\n${(m.bodyText ?? "")
    .trimEnd()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n")}\n`;
  const inner = m.bodyHtml
    ? cleanHtml(m.bodyHtml).replace(/<!doctype[^>]*>|<\/?(html|head|body)[^>]*>|<title>[\s\S]*?<\/title>/gi, "")
    : escapeHtml(m.bodyText ?? "").replace(/\n/g, "<br>");
  const html =
    `<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${inner}</blockquote></div>`;
  return { text, html };
}

/**
 * Composer HTML as Gmail writes it: each Enter is a new line with no gap
 * (a <div>), and an empty line is a visible blank line. Plain <p> tags would
 * get a full line of margin in every mail client, and empty ones collapse.
 */
export function emailHtml(html: string) {
  return cleanHtml(html)
    .replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/gi, "<div><br></div>")
    .replace(/<p(\s[^>]*)?>/gi, "<div$1>")
    .replace(/<\/p>/gi, "</div>")
    .replace(/<(ul|ol|blockquote)>/gi, '<$1 style="margin:0">');
}

/*
 * Thread onto the latest email in the ticket (inbound or ours), whatever its
 * subject: In-Reply-To/References plus the Gmail threadId keep the email in
 * the requester's existing conversation, and the tagged subject still lets
 * ingest file any answer on this ticket.
 */
async function threadingFor(
  client: Awaited<ReturnType<typeof gmailFor>>["client"],
  ticket: typeof tickets.$inferSelect,
) {
  const [last] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.ticketId, ticket.id), isNotNull(messages.rfcMessageId)))
    .orderBy(desc(messages.sentAt))
    .limit(1);

  // Keep our own mailbox's copy in the same conversation too.
  let threadId: string | undefined;
  if (last?.gmailMessageId) {
    const { data } = await client.users.messages
      .get({ userId: "me", id: last.gmailMessageId, format: "minimal" })
      .catch(() => ({ data: { threadId: undefined as string | null | undefined } }));
    threadId = data.threadId ?? undefined;
  }
  threadId ??= ticket.gmailThreadId ?? undefined;

  const references = [
    ...(last?.references ?? []),
    ...(last?.rfcMessageId ? [last.rfcMessageId] : []),
  ].slice(-20);

  return { last: last ?? null, threadId, references };
}

/** Header on automated ticket emails (the CSAT survey) so ingest skips their echo. */
export const AUTO_KIND_HEADER = "X-Ticket-Kind";

/**
 * An automated email on a ticket's conversation (the satisfaction survey):
 * threaded like a reply, so answering it lands on the ticket, but not stored
 * as a message, so it never counts as a response in reports or SLA.
 */
export async function sendTicketNotice(args: {
  ticket: typeof tickets.$inferSelect;
  kind: string;
  fromName: string;
  html: string;
  text: string;
}) {
  const { client } = await gmailFor();
  const { last, threadId, references } = await threadingFor(client, args.ticket);
  const msg = createMimeMessage();
  msg.setSender({ name: args.fromName, addr: env.groupEmail });
  msg.setTo(args.ticket.requesterEmail);
  msg.setSubject(taggedSubject(args.ticket.number, args.ticket.subject));
  if (last?.rfcMessageId) msg.setHeader("In-Reply-To", last.rfcMessageId);
  if (references.length) msg.setHeader("References", references.join(" "));
  msg.setHeader(AUTO_KIND_HEADER, args.kind);
  // Keeps out-of-office replies away; a person's reply still comes through.
  msg.setHeader("Auto-Submitted", "auto-generated");
  msg.setHeader("X-Auto-Response-Suppress", "All");
  msg.addMessage({ contentType: "text/plain", encoding: "base64", data: base64Lines(args.text) });
  msg.addMessage({ contentType: "text/html", encoding: "base64", data: base64Lines(args.html) });
  const raw = Buffer.from(msg.asRaw()).toString("base64url");
  await client.users.messages.send({ userId: "me", requestBody: { raw, threadId } });
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

/**
 * A one-off automated email (e.g. the weekly digest): no ticket, no
 * threading. Marked auto-generated so out-of-office replies stay quiet.
 */
export async function sendNotice(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}) {
  const { client } = await gmailFor();
  const msg = createMimeMessage();
  msg.setSender({ name: args.fromName ?? "Tickets", addr: env.groupEmail });
  msg.setTo(args.to);
  msg.setSubject(args.subject);
  msg.setHeader("Auto-Submitted", "auto-generated");
  msg.setHeader("X-Auto-Response-Suppress", "All");
  msg.addMessage({ contentType: "text/plain", encoding: "base64", data: base64Lines(args.text) });
  msg.addMessage({ contentType: "text/html", encoding: "base64", data: base64Lines(args.html) });
  const raw = Buffer.from(msg.asRaw()).toString("base64url");
  await client.users.messages.send({ userId: "me", requestBody: { raw } });
}
