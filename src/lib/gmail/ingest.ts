import "server-only";
import PostalMime, { type Email, type Address } from "postal-mime";
import { and, eq, inArray, sql } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db, type Tx } from "@/db";
import { agents, attachments, events, messages, tickets } from "@/db/schema";
import { env } from "@/lib/env";
import type { GmailClient } from "./client";
import { stripTicketTag, ticketNumberFromSubject } from "@/lib/ticket-subject";

export type IngestResult =
  | { status: "skipped"; reason: string }
  | { status: "ingested"; ticketId: string; ticketNumber: number; messageId: string };

/* -------------------------------------------------------------- header help */

function headerValue(email: Email, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const h of email.headers ?? []) {
    if (h.key.toLowerCase() === target) return h.value ?? undefined;
  }
  return undefined;
}

function addressList(v: Address[] | undefined): string[] {
  return (v ?? [])
    .flatMap((a) => ("group" in a && a.group ? a.group : [a]))
    .map((a) => ("address" in a ? a.address : undefined))
    .filter((a): a is string => Boolean(a))
    .map((a) => a.toLowerCase());
}

/** `Name <a@b.c>` or bare `a@b.c` -> parts. */
function parseAddress(raw: string | undefined): {
  email: string;
  name: string | null;
} | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const address = (angled ? angled[1] : raw).trim().toLowerCase();
  if (!address.includes("@")) return null;
  let name: string | null = null;
  if (angled) {
    name = raw.slice(0, raw.indexOf("<")).trim().replace(/^"|"$/g, "") || null;
  }
  return { email: address, name };
}

/**
 * Google Groups rewrites `From:` on some configurations, so the header may say
 * the list rather than the person. X-Original-From and Reply-To survive that.
 */
function realSender(email: Email): { email: string; name: string | null } {
  const candidates = [
    headerValue(email, "x-original-from"),
    headerValue(email, "x-google-original-from"),
    email.from ? formatAddress(email.from) : undefined,
    email.replyTo?.[0] ? formatAddress(email.replyTo[0] as Address) : undefined,
  ];

  const group = env.groupEmail.toLowerCase();
  const parsed = candidates
    .map(parseAddress)
    .filter((p): p is { email: string; name: string | null } => Boolean(p));

  // Prefer the first candidate that is not the list address itself.
  return (
    parsed.find((p) => p.email !== group) ??
    parsed[0] ?? { email: group, name: null }
  );
}

function formatAddress(a: Address): string | undefined {
  if ("address" in a && a.address) {
    return a.name ? `${a.name} <${a.address}>` : a.address;
  }
  return undefined;
}

function referenceIds(email: Email): string[] {
  const raw = headerValue(email, "references") ?? "";
  return [...raw.matchAll(/<[^>]+>/g)].map((m) => m[0]);
}

function normaliseSubject(subject: string | undefined): string {
  const s = (subject ?? "").trim();
  return s.length ? s : "(no subject)";
}

function stripReplyPrefix(subject: string) {
  return stripTicketTag(
    subject.replace(/^((re|fwd?|aw|sv)\s*(\[\d+\])?:\s*)+/i, "").trim(),
  );
}

/* ----------------------------------------------------------------- ingest */

/**
 * Fetch one Gmail message and fold it into a ticket.
 *
 * Idempotent: the unique constraint on messages.gmail_message_id means a
 * replayed Pub/Sub delivery is a no-op, so the push handler can safely 500
 * and let Pub/Sub retry.
 */
export async function ingestGmailMessage(
  client: GmailClient,
  gmailMessageId: string,
  options: { imported?: boolean } = {},
): Promise<IngestResult> {
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.gmailMessageId, gmailMessageId))
    .limit(1);
  if (existing.length) {
    return { status: "skipped", reason: "already ingested (gmail id)" };
  }

  const { data } = await client.users.messages.get({
    userId: "me",
    id: gmailMessageId,
    format: "raw",
  });

  if (!data.raw) return { status: "skipped", reason: "no raw payload" };

  const parsed = await PostalMime.parse(Buffer.from(data.raw, "base64url"));
  return ingestParsedEmail({
    parsed,
    gmailMessageId,
    gmailThreadId: data.threadId ?? null,
    internalDate: data.internalDate ? Number(data.internalDate) : undefined,
    imported: options.imported,
  });
}

export async function ingestParsedEmail(input: {
  parsed: Email;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  internalDate?: number;
  /** Set by the backfill: a ticket it creates is marked as imported. */
  imported?: boolean;
}): Promise<IngestResult> {
  const { parsed, gmailMessageId, gmailThreadId } = input;

  const rfcMessageId = parsed.messageId ?? null;
  const sender = realSender(parsed);
  const inReplyTo = headerValue(parsed, "in-reply-to")?.match(/<[^>]+>/)?.[0] ?? null;
  const refs = referenceIds(parsed);
  const subject = normaliseSubject(parsed.subject);
  const sentAt = parsed.date
    ? new Date(parsed.date)
    : input.internalDate
      ? new Date(input.internalDate)
      : new Date();

  // Our own outbound copy coming back around through the group.
  if (rfcMessageId) {
    const dupe = await db
      .select({ id: messages.id, ticketId: messages.ticketId })
      .from(messages)
      .where(eq(messages.rfcMessageId, rfcMessageId))
      .limit(1);
    if (dupe.length) {
      // Claim the Gmail id so we never re-fetch this one.
      if (gmailMessageId) {
        await db
          .update(messages)
          .set({ gmailMessageId })
          .where(and(eq(messages.id, dupe[0].id), sql`${messages.gmailMessageId} is null`));
      }
      return { status: "skipped", reason: "echo of a message we already have" };
    }
  }

  // Is the sender one of us? Then this is an outbound reply that bypassed the
  // portal (someone hit reply-all in Gmail).
  const [agent] = await db
    .select()
    .from(agents)
    .where(sql`lower(${agents.email}) = ${sender.email}`)
    .limit(1);

  const direction = agent ? "outbound" : "inbound";

  const result = await db.transaction(async (tx) => {
    const ticket = await findOrCreateTicket(tx, {
      inReplyTo,
      refs,
      gmailThreadId,
      subject,
      sender,
      direction,
      sentAt,
      imported: input.imported ?? false,
    });

    const [inserted] = await tx
      .insert(messages)
      .values({
        ticketId: ticket.id,
        direction,
        gmailMessageId,
        rfcMessageId,
        inReplyTo,
        references: refs,
        fromEmail: sender.email,
        fromName: sender.name,
        toEmails: addressList(parsed.to),
        ccEmails: addressList(parsed.cc),
        subject,
        bodyText: parsed.text ?? null,
        bodyHtml: parsed.html ?? null,
        authorAgentId: agent?.id ?? null,
        sentAt,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });

    if (!inserted) {
      return { status: "skipped" as const, reason: "raced with another delivery" };
    }

    const reopened =
      direction === "inbound" &&
      (ticket.status === "solved" || ticket.status === "closed");

    await tx
      .update(tickets)
      .set({
        lastMessageAt: sentAt,
        updatedAt: new Date(),
        ...(reopened ? { status: "open" as const } : {}),
      })
      .where(eq(tickets.id, ticket.id));

    if (reopened) {
      await tx.insert(events).values({
        ticketId: ticket.id,
        kind: "reopened",
        data: { by: sender.email },
      });
    }

    return {
      status: "ingested" as const,
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      messageId: inserted.id,
    };
  });

  if (result.status === "ingested") {
    await storeAttachments(result.messageId, parsed);
  }
  return result;
}

/* ------------------------------------------------------------- threading */

async function findOrCreateTicket(
  tx: Tx,
  args: {
    inReplyTo: string | null;
    refs: string[];
    gmailThreadId: string | null;
    subject: string;
    sender: { email: string; name: string | null };
    direction: "inbound" | "outbound";
    sentAt: Date;
    imported: boolean;
  },
) {
  const candidateIds = [args.inReplyTo, ...args.refs].filter(
    (v): v is string => Boolean(v),
  );

  // 1. In-Reply-To / References against message ids we have stored.
  if (candidateIds.length) {
    const [hit] = await tx
      .select({ ticketId: messages.ticketId })
      .from(messages)
      .where(inArray(messages.rfcMessageId, candidateIds))
      .limit(1);
    if (hit) {
      const [t] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.id, hit.ticketId))
        .limit(1);
      if (t) return t;
    }
  }

  // 2. The [TICKET: #1234] tag our replies put in the subject.
  const tagged = ticketNumberFromSubject(args.subject);
  if (tagged) {
    const [t] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.number, tagged))
      .limit(1);
    if (t) return t;
  }

  // 3. Gmail's own threadId.
  if (args.gmailThreadId) {
    const [t] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.gmailThreadId, args.gmailThreadId))
      .limit(1);
    if (t) return t;
  }

  // 4. New ticket.
  const [created] = await tx
    .insert(tickets)
    .values({
      subject: stripReplyPrefix(args.subject) || args.subject,
      requesterEmail: args.sender.email,
      requesterName: args.sender.name,
      gmailThreadId: args.gmailThreadId,
      // "Opened" is when the email was sent, not when we happened to fetch it.
      createdAt: args.sentAt,
      lastMessageAt: args.sentAt,
      imported: args.imported,
      status: "open",
    })
    .returning();

  await tx.insert(events).values({
    ticketId: created.id,
    kind: "created",
    data: { via: "email", from: args.sender.email },
  });

  return created;
}

/* ----------------------------------------------------------- attachments */

async function storeAttachments(messageId: string, parsed: Email) {
  const list = parsed.attachments ?? [];
  if (!list.length) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;

  for (const att of list) {
    try {
      const filename = att.filename || "attachment";
      const body =
        att.content instanceof ArrayBuffer
          ? Buffer.from(att.content)
          : Buffer.from(att.content as unknown as string, "utf8");

      const blob = await put(`messages/${messageId}/${filename}`, body, {
        access: "public",
        addRandomSuffix: true,
        contentType: att.mimeType || "application/octet-stream",
      });

      await db.insert(attachments).values({
        messageId,
        filename,
        contentType: att.mimeType ?? null,
        size: body.byteLength,
        blobUrl: blob.url,
      });
    } catch (err) {
      console.error("attachment upload failed", err);
    }
  }
}

export const __test = {
  realSender,
  stripReplyPrefix,
  referenceIds,
  parseAddress,
};
