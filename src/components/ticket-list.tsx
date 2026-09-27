"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import type { TicketListItem } from "@/lib/queries";
import type { PhotoMap } from "@/lib/people";
import { assignToMe, toggleStar } from "@/lib/actions/tickets";
import { useHotkeys } from "@/lib/hotkeys";
import { Avatar } from "@/components/ui/avatar";
import { TagBadge } from "@/components/ui/badge";
import { PriorityIcon, StatusIcon } from "@/components/ui/ticket-icons";
import { AgeBadge } from "@/components/ui/age-badge";
import { cn } from "@/lib/utils";

export function TicketList({
  rows,
  photos,
  me,
}: {
  rows: TicketListItem[];
  photos: PhotoMap;
  me: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const [cursor, setCursor] = useState(-1);
  const [, start] = useTransition();
  const [starred, flipStar] = useOptimistic(
    new Set(rows.filter((r) => r.starred).map((r) => r.id)),
    (set: Set<string>, id: string) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    },
  );
  const [mine, claim] = useOptimistic(
    new Set(rows.filter((r) => r.assignees.some((a) => a.id === me.id)).map((r) => r.id)),
    (set: Set<string>, id: string) => new Set(set).add(id),
  );
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (cursor < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function star(id: string) {
    start(async () => {
      flipStar(id);
      await toggleStar(id);
    });
  }

  const current = rows[cursor];
  useHotkeys({
    j: () => setCursor((c) => Math.min(c + 1, rows.length - 1)),
    k: () => setCursor((c) => Math.max(c - 1, 0)),
    ArrowDown: () => setCursor((c) => Math.min(c + 1, rows.length - 1)),
    ArrowUp: () => setCursor((c) => Math.max(c - 1, 0)),
    Enter: () => current && router.push(`/tickets/${current.number}`),
    o: () => current && router.push(`/tickets/${current.number}`),
    s: () => current && star(current.id),
    i: () =>
      current &&
      !mine.has(current.id) &&
      start(async () => {
        claim(current.id);
        await assignToMe(current.id);
      }),
  });

  if (rows.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-10 text-center">
        <div>
          <p className="text-sm font-medium">Nothing here</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            New mail to the group shows up within a few seconds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul ref={listRef} className="flex-1 overflow-y-auto">
      {rows.map((t, i) => {
        const isStarred = starred.has(t.id);
        const assigned =
          mine.has(t.id) && !t.assignees.some((a) => a.id === me.id)
            ? [...t.assignees, { id: me.id, name: me.name, email: me.email }]
            : t.assignees;
        const unsolved = t.status === "open" || t.status === "pending";

        return (
          <li key={t.id} data-row={i}>
            <div
              className={cn(
                "group relative flex h-12 items-center gap-3 border-b border-[var(--border)] pl-3 pr-4 text-sm",
                i === cursor ? "bg-[var(--accent)]" : "hover:bg-[var(--muted)]",
              )}
            >
              {i === cursor && (
                <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--primary)]" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => star(t.id)}
                className={cn(
                  "relative z-10 rounded p-1 text-[var(--muted-foreground)] hover:text-amber-500",
                  !isStarred && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
                aria-pressed={isStarred}
                aria-label={isStarred ? "Unstar" : "Star"}
              >
                <Star className={cn("size-4", isStarred && "fill-amber-400 text-amber-400")} />
              </button>

              <span
                title={t.priority === "none" ? "No priority" : t.priority.toUpperCase()}
                className="flex w-6 shrink-0 justify-center"
              >
                <PriorityIcon priority={t.priority} />
              </span>
              <span className="w-12 shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">
                #{t.number}
              </span>
              <span title={t.status} className="shrink-0">
                <StatusIcon status={t.status} />
              </span>

              <Link
                href={`/tickets/${t.number}`}
                className="flex min-w-0 flex-1 items-center gap-2 after:absolute after:inset-0"
                onFocus={() => setCursor(i)}
              >
                <Avatar
                  name={t.requesterName}
                  email={t.requesterEmail}
                  photo={photos[t.requesterEmail.toLowerCase()]}
                  size="xs"
                />
                <span className="w-36 shrink-0 truncate text-[var(--muted-foreground)]">
                  {t.requesterName || t.requesterEmail}
                </span>
                <span className={cn("truncate", unsolved ? "font-medium" : "text-[var(--muted-foreground)]")}>
                  {t.subject}
                </span>
                {t.messageCount > 1 && (
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {t.messageCount}
                  </span>
                )}
              </Link>

              <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
                {t.tags.slice(0, 2).map((tag) => (
                  <TagBadge key={tag.slug} name={tag.name} color={tag.color} />
                ))}
                {t.tags.length > 2 && (
                  <span className="text-xs text-[var(--muted-foreground)]">+{t.tags.length - 2}</span>
                )}
                {t.teamName && (
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                    {t.teamName}
                  </span>
                )}
              </div>

              <span
                className="flex w-14 shrink-0 justify-end"
                title={assigned.length ? `Assigned to ${assigned.map((a) => a.name).join(", ")}` : "Unassigned"}
              >
                {assigned.length ? (
                  <span className="flex -space-x-1.5">
                    {assigned.slice(0, 3).map((a) => (
                      <Avatar
                        key={a.id}
                        name={a.name}
                        email={a.email}
                        photo={photos[a.email.toLowerCase()]}
                        size="sm"
                        className="ring-2 ring-[var(--background)]"
                      />
                    ))}
                  </span>
                ) : (
                  <span className="block size-6 rounded-full border border-dashed border-[var(--input)]" />
                )}
              </span>
              <AgeBadge
                since={t.createdAt}
                resolved={!unsolved}
                className="w-[92px] justify-end"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
