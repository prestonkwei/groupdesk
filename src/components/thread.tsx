"use client";

import { useState } from "react";
import { ChevronDown, Lock, Paperclip } from "lucide-react";
import type { ThreadEvent, ThreadMessage } from "@/lib/queries";
import type { PhotoMap } from "@/lib/people";
import { HtmlBody, TextBody, splitQuote } from "./message-body";
import { Avatar } from "@/components/ui/avatar";
import { cn, dateTime, relativeTime } from "@/lib/utils";

type Item =
  | { kind: "message"; at: Date; message: ThreadMessage }
  | { kind: "events"; at: Date; events: ThreadEvent[] };

function describe(e: ThreadEvent): string {
  const who = e.actorName ?? "Someone";
  const d = e.data as Record<string, string | undefined>;
  switch (e.kind) {
    case "created":
      return "opened this ticket by email";
    case "reopened":
      return `reopened by a new reply from ${d.by ?? "the requester"}`;
    case "assigned":
      return `${who} assigned ${d.assigneeName ?? "someone"}`;
    case "unassigned":
      return d.assigneeName ? `${who} unassigned ${d.assigneeName}` : `${who} unassigned`;
    case "status":
      if ((e.data as { auto?: boolean }).auto) {
        return `Auto-solved after ${d.days ?? "several"} days without a reply`;
      }
      return `${who} set status to ${d.to}`;
    case "priority":
      return `${who} set priority to ${d.to}`;
    case "team":
      return d.teamName ? `${who} moved to ${d.teamName}` : `${who} cleared the team`;
    case "requester":
      return d.via === "forward"
        ? `${who} forwarded this; requester set to ${d.toName ?? d.to}`
        : `${who} changed the requester to ${d.toName ?? d.to}`;
    case "merged":
      return `${who} merged #${d.fromNumber} (${d.fromSubject}) into this ticket`;
    case "spam":
      return (e.data as { auto?: boolean }).auto
        ? `Closed automatically: ${d.email} is marked as spam`
        : `${who} closed this as spam and blocked ${d.email}`;
    case "tag_added":
      return `${who} added ${d.tagName}`;
    case "tag_removed":
      return `${who} removed ${d.tagName}`;
    case "csat_sent":
      return `Satisfaction survey emailed to ${d.to}`;
    case "csat_skipped":
      return `No satisfaction survey: ${d.reason}`;
    case "csat_failed":
      return `Satisfaction survey failed to send: ${d.error}`;
    case "csat":
      return `${d.by ?? "The requester"} rated this ${d.rating === "good" ? "👍" : "👎"}${d.comment ? `: “${d.comment}”` : ""}`;
    default:
      return `${who} · ${e.kind}`;
  }
}

/** One-line preview of a collapsed message, without the quoted history. */
function snippet(m: ThreadMessage) {
  const text = m.bodyHtml
    ? m.bodyHtml
        .split(/<(?:div|blockquote)[^>]*class="[^"]*gmail_quote|<blockquote[^>]*type="cite"/i)[0]
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
    : splitQuote(m.bodyText ?? "")[0];
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}


export function Thread({
  messages,
  events,
  photos,
}: {
  messages: ThreadMessage[];
  events: ThreadEvent[];
  photos: PhotoMap;
}) {
  // "created" just restates the first message, so it isn't shown.
  const visibleEvents = events.filter((e) => e.kind !== "created");

  const sorted = [
    ...messages.map((m) => ({ kind: "message" as const, at: m.sentAt, message: m })),
    ...visibleEvents.map((e) => ({ kind: "event" as const, at: e.createdAt, event: e })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Runs of activity collapse into one quiet line between messages.
  const items: Item[] = [];
  for (const it of sorted) {
    if (it.kind === "message") items.push(it);
    else {
      const last = items[items.length - 1];
      if (last?.kind === "events") last.events.push(it.event);
      else items.push({ kind: "events", at: it.at, events: [it.event] });
    }
  }

  const messageIds = messages.map((m) => m.id);
  const lastId = messageIds[messageIds.length - 1];
  // Long threads start with only the first and latest messages open.
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(messages.length <= 3 ? messageIds : [messageIds[0], lastId].filter(Boolean)),
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const collapsedCount = messageIds.filter((id) => !expanded.has(id)).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
      {collapsedCount > 1 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setExpanded(new Set(messageIds))}
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
          >
            Expand all
          </button>
        </div>
      )}

      <ol className="flex flex-col">
        {items.map((item) =>
          item.kind === "events" ? (
            <li
              key={`e-${item.events[0].id}`}
              className="flex gap-3 py-2 pl-[11px] text-xs text-[var(--muted-foreground)]"
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--border)]" />
              <span className="min-w-0">
                {item.events.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && " · "}
                    {describe(e)}
                  </span>
                ))}
                <span className="ml-1.5 opacity-70">{relativeTime(item.at)}</span>
              </span>
            </li>
          ) : (
            <li key={`m-${item.message.id}`} className="py-1.5">
              <MessageCard
                message={item.message}
                photo={photos[(item.message.authorEmail ?? item.message.fromEmail).toLowerCase()]}
                open={expanded.has(item.message.id)}
                onToggle={() => toggle(item.message.id)}
              />
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

/** "to Jamie, cc help ▾" under an open email; expands to the full header. */
function Recipients({ message: m }: { message: ThreadMessage }) {
  const [open, setOpen] = useState(false);
  const bcc = m.bccEmails ?? [];
  const short = (e: string) => e.split("@")[0];
  const summary = [
    m.toEmails.length ? `to ${m.toEmails.map(short).join(", ")}` : "",
    m.ccEmails.length ? `cc ${m.ccEmails.map(short).join(", ")}` : "",
    bcc.length ? `bcc ${bcc.map(short).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const rows: [string, string][] = [
    ["From", m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail],
    ["To", m.toEmails.join(", ")],
    ["Cc", m.ccEmails.join(", ")],
    ["Bcc", bcc.join(", ")],
    ["Date", dateTime(m.sentAt)],
    ["Subject", m.subject ?? ""],
  ];
  return (
    <div className="-mt-1 mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1 rounded text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        title={open ? "Hide details" : "Show who this was sent to"}
      >
        <span className="truncate">{summary || "no recipients recorded"}</span>
        <ChevronDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-right text-[var(--muted-foreground)]">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}

function MessageCard({
  message: m,
  photo,
  open,
  onToggle,
}: {
  message: ThreadMessage;
  photo: string | null | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const isNote = m.direction === "note";
  const isOutbound = m.direction === "outbound";
  const name = m.fromName || m.fromEmail;

  return (
    <article
      className={cn(
        "rounded-xl border transition-colors",
        isNote
          ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30"
          : "border-[var(--border)] bg-[var(--card)]",
        !open && "hover:bg-[var(--muted)]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-3 text-left sm:px-4"
      >
        <Avatar name={m.fromName} email={m.fromEmail} photo={photo} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">{name}</span>
            {open && m.fromName && (
              <span className="hidden truncate text-xs text-[var(--muted-foreground)] sm:inline">
                {m.fromEmail}
              </span>
            )}
            {isNote && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-200/70 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                <Lock className="size-2.5" />
                Internal
              </span>
            )}
            {isOutbound && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Sent from portal
              </span>
            )}
            <time
              className="ml-auto shrink-0 text-xs text-[var(--muted-foreground)]"
              title={dateTime(m.sentAt)}
              dateTime={new Date(m.sentAt).toISOString()}
            >
              {open ? dateTime(m.sentAt) : relativeTime(m.sentAt)}
            </time>
          </div>
          {!open && (
            <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
              {m.attachments.length > 0 && <Paperclip className="mr-1 inline size-3" />}
              {snippet(m) || "(empty message)"}
            </p>
          )}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-4 sm:px-4 sm:pl-[60px]">
          {!isNote && <Recipients message={m} />}
          {m.bodyHtml ? (
            <HtmlBody html={m.bodyHtml} />
          ) : (
            <TextBody text={m.bodyText ?? "(empty message)"} />
          )}

          {m.attachments.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={`/api/attachments/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-64 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs hover:bg-[var(--accent)]"
                  >
                    <Paperclip className="size-3 shrink-0" />
                    <span className="truncate">{a.filename}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
