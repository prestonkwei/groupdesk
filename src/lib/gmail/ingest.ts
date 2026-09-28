import "server-only";
import PostalMime, { type Email, type Address } from "postal-mime";
import { and, eq, inArray, sql } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db, type Tx } from "@/db";
import {
  agents,
  attachments,
  blockedSenders,
  events,
  messages,
  tickets,
  type Ticket,
} from "@/db/schema";
import { env } from "@/lib/env";
import type { GmailClient } from "./client";
import { notifyReply } from "@/lib/notify";
import { isDigestSubject, stripTicketTag, ticketNumberFromSubject } from "@/lib/ticket-subject";
import { flagVipIfFaculty } from "@/lib/vip";

export type IngestResult =
  | { status: "skipped"; reason: string }
  | { status: "ingested"; ticketId: string; ticketNumber: number; messageId: string; newTicket: boolean };

/** HTTP status of a Google API error (gaxios puts it in a few places). */
export function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: number } };
  const n = Number(e?.response?.status ?? e?.status ?? e?.code);
  return Number.isFinite(n) ? n : undefined;
}

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

/**
 * When an agent forwards someone's email to the group ("Fwd: …"), the real
 * requester is the "From:" inside the forwarded block, not the agent. Handles
 * Gmail ("---------- Forwarded message ---------"), Apple Mail ("Begin
 * forwarded message:") and Outlook ("From: … Sent: …") layouts.
 */
function forwardedSender(email: Email, subject: string): { email: string; name: string | null } | null {
  const text =
    email.text ??
    (email.html ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ");
  const marker = text.search(
    /-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,}|_{10,}/i,
  );
  const looksForwarded = /^\s*(fwd?|fw)\s*:/i.test(subject);
  if (marker < 0 && !looksForwarded) return null;
  const block = text.slice(Math.max(marker, 0), Math.max(marker, 0) + 2000);
  const line = block.match(/^[>\s*]*From:\s*\*?\s*(.+?)\s*\*?$/im)?.[1];
  // "From: Jamie Rivera <jrivera@x.org>", "From: jrivera@x.org" or
  // "From: Jamie Rivera [mailto:jrivera@x.org]".
  const normalised = line?.replace(/\[mailto:([^\]]+)\]/i, "<$1>");
  return parseAddress(normalised);
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

  let data;
  try {
    ({ data } = await client.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "raw",
    }));
  } catch (err) {
    // History lists messages that are gone by the time we ask: a draft that
    // was sent or discarded, or mail deleted right away. Nothing to ingest.
    if (httpStatus(err) === 404) {
      return { status: "skipped", reason: "no longer in Gmail (deleted or a draft)" };
    }
    throw err;
  }

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

  // Replies to the weekly digest (sent from the group address) aren't requests.
  if (isDigestSubject(subject)) {
    return { status: "skipped", reason: "reply to the weekly digest" };
  }

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

  // An agent forwarding someone else's email: that someone is the requester,
  // and the message is theirs as far as the ticket is concerned.
  const forwardedFrom = agent ? forwardedSender(parsed, subject) : null;
  const forwarded =
    forwardedFrom && forwardedFrom.email !== sender.email && forwardedFrom.email !== env.groupEmail.toLowerCase()
      ? forwardedFrom
      : null;

  const direction = agent && !forwarded ? "outbound" : "inbound";

  const result = await db.transaction(async (tx) => {
    const { ticket, created } = await findOrCreateTicket(tx, {
      inReplyTo,
      refs,
      gmailThreadId,
      subject,
      sender,
      requester: forwarded ?? sender,
      direction,
      sentAt,
      imported: input.imported ?? false,
    });

    // Senders marked as spam still land (so nothing is lost) but closed.
    if (created && direction === "inbound") {
      const requester = (forwarded ?? sender).email;
      const [blocked] = await tx
        .select({ email: blockedSenders.email })
        .from(blockedSenders)
        .where(eq(blockedSenders.email, requester))
        .limit(1);
      if (blocked) {
        await tx.update(tickets).set({ status: "closed" }).where(eq(tickets.id, ticket.id));
        ticket.status = "closed";
        await tx.insert(events).values({
          ticketId: ticket.id,
          kind: "spam",
          data: { email: requester, auto: true },
          createdAt: sentAt,
        });
      }
    }

    if (created && forwarded) {
      await tx.insert(events).values({
        ticketId: ticket.id,
        actorAgentId: agent?.id ?? null,
        kind: "requester",
        data: { to: forwarded.email, toName: forwarded.name, via: "forward" },
        createdAt: sentAt,
      });
    }

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

    // A reply from the requester puts the ball back in our court: solved and
    // closed tickets reopen, and "pending" (waiting on them) goes back to open
    // so it can't be auto-solved while their answer sits unread.
    // Only the newest message can change the state: an older email that
    // arrives late (catch-up, backfill) doesn't reopen anything or move
    // "last message" backwards.
    const isNewest = created || sentAt >= ticket.lastMessageAt;
    const reopened =
      !created &&
      isNewest &&
      direction === "inbound" &&
      (ticket.status === "solved" || ticket.status === "closed" || ticket.status === "pending");

    await tx
      .update(tickets)
      .set({
        lastMessageAt: sql`greatest(${tickets.lastMessageAt}, ${sentAt})`,
        updatedAt: new Date(),
        ...(reopened ? { status: "open" as const } : {}),
      })
      .where(eq(tickets.id, ticket.id));

    if (reopened) {
      await tx.insert(events).values({
        ticketId: ticket.id,
        kind: "reopened",
        data: { by: sender.email },
        // Timeline order follows the email, not when we fetched it.
        createdAt: sentAt,
      });
    }

    return {
      status: "ingested" as const,
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      messageId: inserted.id,
      newTicket: created,
      // Tell assignees about a fresh reply (not about old mail the backfill
      // or a catch-up is filling in).
      notify:
        !created && isNewest && direction === "inbound" && !input.imported
          ? { id: ticket.id, number: ticket.number, subject: ticket.subject }
          : null,
    };
  });

  if (result.status === "ingested" && result.notify) {
    const snippet = (parsed.text ?? "").split(/\n\s*On .{5,200}wrote:/)[0].trim().slice(0, 400);
    await notifyReply(result.notify, forwarded ?? sender, snippet).catch((err) =>
      console.error("reply notification failed", err),
    );
  }

  if (result.status === "ingested") {
    await storeAttachments(result.messageId, parsed);
    if (result.newTicket && direction === "inbound") {
      await flagVipIfFaculty(result.ticketId, (forwarded ?? sender).email);
    }
  }
  return result;
}

/* ------------------------------------------------------------- threading */

/** Finds the ticket for an email (following merges) or creates one. */
async function findOrCreateTicket(
  tx: Tx,
  args: Parameters<typeof findOrCreateTicketRaw>[1],
): Promise<{ ticket: Ticket; created: boolean }> {
  const result = await findOrCreateTicketRaw(tx, args);
  let ticket = result.ticket;
  // A merged ticket forwards to the one it went into.
  for (let hops = 0; ticket.mergedIntoId && hops < 5; hops++) {
    const [next] = await tx.select().from(tickets).where(eq(tickets.id, ticket.mergedIntoId)).limit(1);
    if (!next) break;
    ticket = next;
  }
  return { ticket, created: result.created };
}

async function findOrCreateTicketRaw(
  tx: Tx,
  args: {
    inReplyTo: string | null;
    refs: string[];
    gmailThreadId: string | null;
    subject: string;
    sender: { email: string; name: string | null };
    /** Who the ticket is for: the sender, or the original author of a forward. */
    requester: { email: string; name: string | null };
    direction: "inbound" | "outbound";
    sentAt: Date;
    imported: boolean;
  },
): Promise<{ ticket: Ticket; created: boolean }> {
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
      if (t) return { ticket: t, created: false };
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
    if (t) return { ticket: t, created: false };
  }

  // 3. Gmail's own threadId.
  if (args.gmailThreadId) {
    const [t] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.gmailThreadId, args.gmailThreadId))
      .limit(1);
    if (t) return { ticket: t, created: false };
  }

  // 4. New ticket.
  const [created] = await tx
    .insert(tickets)
    .values({
      subject: stripReplyPrefix(args.subject) || args.subject,
      requesterEmail: args.requester.email,
      requesterName: args.requester.name,
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
    createdAt: args.sentAt,
  });

  return { ticket: created, created: true };
}

/* ----------------------------------------------------------- attachments */

/**
 * Vercel Blob stores are either private or public, and each only accepts its
 * own kind of upload. Try private first (attachments can be sensitive), fall
 * back to public, and remember which one worked.
 */
let blobAccess: "private" | "public" | null = null;

async function putAttachment(path: string, body: Buffer, contentType: string) {
  const order: ("private" | "public")[] = blobAccess ? [blobAccess] : ["private", "public"];
  let lastError: unknown;
  for (const access of order) {
    try {
      const blob = await put(path, body, { access, addRandomSuffix: true, contentType });
      blobAccess = access;
      return blob;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

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

      const blob = await putAttachment(
        `messages/${messageId}/${filename}`,
        body,
        att.mimeType || "application/octet-stream",
      );

      await db.insert(attachments).values({
        messageId,
        filename,
        contentType: att.mimeType ?? null,
        size: body.byteLength,
        blobUrl: blob.url,
        contentId: att.contentId?.replace(/^<|>$/g, "").trim() || null,
      });
    } catch (err) {
      console.error("attachment upload failed", err);
    }
  }
}

export const __test = {
  forwardedSender,
  realSender,
  stripReplyPrefix,
  referenceIds,
  parseAddress,
};
