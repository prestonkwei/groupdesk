import "server-only";
import { createMimeMessage } from "mimetext";
import { desc, eq, isNotNull, and } from "drizzle-orm";
import { db } from "@/db";
import { messages, tickets, type Agent } from "@/db/schema";
import { env } from "@/lib/env";
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
  bodyText: string;
}): Promise<SentReply> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, args.ticketId))
    .limit(1);
  if (!ticket) throw new Error("Ticket not found");

  // Latest message that actually has a Message-ID, for threading headers.
  const [last] = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.ticketId, ticket.id), isNotNull(messages.rfcMessageId)),
    )
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const { client, email: mailbox } = await gmailFor();

  const subject = ticket.subject.match(/^re:/i)
    ? ticket.subject
    : `Re: ${ticket.subject}`;

  const msg = createMimeMessage();
  msg.setSender({ name: args.agent.name, addr: mailbox });
  msg.setRecipient(ticket.requesterEmail);
  msg.setCc(env.groupEmail);
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
  msg.addMessage({ contentType: "text/plain", data: body });

  const raw = Buffer.from(msg.asRaw()).toString("base64url");

  const { data: sent } = await client.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: ticket.gmailThreadId ?? undefined,
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
      fromEmail: mailbox,
      fromName: args.agent.name,
      toEmails: [ticket.requesterEmail],
      ccEmails: [env.groupEmail],
      subject,
      bodyText: body,
      bodyHtml: null,
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
