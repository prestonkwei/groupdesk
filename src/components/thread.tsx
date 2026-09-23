import { Paperclip } from "lucide-react";
import type { ThreadEvent, ThreadMessage } from "@/lib/queries";
import { HtmlBody, TextBody } from "./message-body";
import { cn, initials, relativeTime } from "@/lib/utils";

type Item =
  | { kind: "message"; at: Date; message: ThreadMessage }
  | { kind: "event"; at: Date; event: ThreadEvent };

function describe(e: ThreadEvent): string {
  const who = e.actorName ?? "Someone";
  const d = e.data as Record<string, string | undefined>;
  switch (e.kind) {
    case "created":
      return `Ticket created from email from ${d.from ?? "the requester"}`;
    case "reopened":
      return `Reopened by a new reply from ${d.by ?? "the requester"}`;
    case "assigned":
      return `${who} assigned this to ${d.assigneeName ?? "someone"}`;
    case "unassigned":
      return `${who} unassigned this`;
    case "status":
      return `${who} changed status from ${d.from} to ${d.to}`;
    case "team":
      return d.teamName ? `${who} moved this to ${d.teamName}` : `${who} cleared the team`;
    case "tag_added":
      return `${who} added the tag ${d.tagName}`;
    case "tag_removed":
      return `${who} removed the tag ${d.tagName}`;
    default:
      return `${who} · ${e.kind}`;
  }
}

export function Thread({
  messages,
  events,
}: {
  messages: ThreadMessage[];
  events: ThreadEvent[];
}) {
  const items: Item[] = [
    ...messages.map((m) => ({ kind: "message" as const, at: m.sentAt, message: m })),
    ...events.map((e) => ({ kind: "event" as const, at: e.createdAt, event: e })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="flex flex-col gap-4 p-5">
      {items.map((item) =>
        item.kind === "event" ? (
          <p
            key={`e-${item.event.id}`}
            className="px-1 text-xs text-[var(--muted-foreground)]"
          >
            {describe(item.event)} · {relativeTime(item.at)}
          </p>
        ) : (
          <MessageCard key={`m-${item.message.id}`} message={item.message} />
        ),
      )}
    </div>
  );
}

function MessageCard({ message: m }: { message: ThreadMessage }) {
  const isNote = m.direction === "note";
  const isOutbound = m.direction === "outbound";

  return (
    <article
      className={cn(
        "rounded-lg border p-4",
        isNote
          ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
          : isOutbound
            ? "border-[var(--border)] bg-[var(--muted)]"
            : "border-[var(--border)] bg-[var(--card)]",
      )}
    >
      <header className="mb-3 flex items-center gap-2 text-xs">
        <span className="grid size-6 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-semibold text-[var(--accent-foreground)]">
          {initials(m.fromName || m.fromEmail)}
        </span>
        <span className="font-medium">{m.fromName || m.fromEmail}</span>
        {m.fromName && (
          <span className="text-[var(--muted-foreground)]">{m.fromEmail}</span>
        )}
        {isNote && (
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            Internal note
          </span>
        )}
        {isOutbound && !isNote && (
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            Reply
          </span>
        )}
        <time className="ml-auto text-[var(--muted-foreground)]">
          {new Date(m.sentAt).toLocaleString()}
        </time>
      </header>

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
                href={a.blobUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--accent)]"
              >
                <Paperclip className="size-3" />
                {a.filename}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
