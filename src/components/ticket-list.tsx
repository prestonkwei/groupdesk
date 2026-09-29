"use client";

import { forwardRef, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Star, Tag as TagIcon, UserRound, Users, X } from "lucide-react";
import type { TicketFilters, TicketListItem } from "@/lib/queries";
import type { PhotoMap } from "@/lib/people";
import type { TicketPriority, TicketStatus } from "@/db/schema";
import {
  assignToMe,
  bulkUpdate,
  loadMoreTickets,
  toggleStar,
  type BulkOp,
} from "@/lib/actions/tickets";
import { useHotkeys } from "@/lib/hotkeys";
import { Avatar } from "@/components/ui/avatar";
import { TagBadge, VIP_RING, VipMark } from "@/components/ui/badge";
import { isVipTag } from "@/lib/vip-tag";
import { Picker } from "@/components/ui/picker";
import {
  PRIORITIES,
  PriorityIcon,
  STATUSES,
  StatusIcon,
} from "@/components/ui/ticket-icons";
import { AgeBadge } from "@/components/ui/age-badge";
import { SlaPill } from "@/components/ui/sla-pill";
import { Kbd } from "@/components/shortcuts";
import { cn } from "@/lib/utils";

type AgentOption = { id: string; name: string; email: string };
type Option = { id: string; name: string };
type BulkPicker = "status" | "priority" | "assignee" | "team" | "tags";

export function TicketList({
  rows: firstPage,
  photos: firstPhotos,
  total,
  filters,
  me,
  agents,
  teams,
  tags,
}: {
  rows: TicketListItem[];
  photos: PhotoMap;
  /** How many tickets match overall; more pages load as you scroll. */
  total: number;
  filters: TicketFilters;
  me: { id: string; name: string; email: string };
  agents: AgentOption[];
  teams: Option[];
  tags: (Option & { color: string })[];
}) {
  const router = useRouter();

  /* ------------------------------------------------------------- paging */

  // The server renders the first page (and keeps it fresh via LiveRefresh);
  // later pages are fetched on demand and appended here.
  const [extra, setExtra] = useState<{ rows: TicketListItem[]; photos: PhotoMap }>({
    rows: [],
    photos: {},
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const seen = new Set<string>();
  const rows = [...firstPage, ...extra.rows].filter((r) =>
    seen.has(r.id) ? false : (seen.add(r.id), true),
  );
  const photos = { ...extra.photos, ...firstPhotos };
  const hasMore = rows.length < total;
  const sentinel = useRef<HTMLLIElement>(null);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await loadMoreTickets(filters, rows.length);
      setExtra((prev) => ({
        rows: [...prev.rows, ...next.rows],
        photos: { ...prev.photos, ...next.photos },
      }));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadMore(),
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });

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

  /* ------------------------------------------------------------ selection */

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  // Tickets that leave the view (e.g. solved out of Unsolved) drop out of the selection.
  const selectedRows = rows.filter((r) => picked.has(r.id));
  const selected = new Set(selectedRows.map((r) => r.id));
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleRow(i: number, range: boolean) {
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => rows.some((r) => r.id === id)));
      const id = rows[i].id;
      const turnOn = !next.has(id);
      if (range && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
        for (let k = a; k <= b; k++) {
          if (turnOn) next.add(rows[k].id);
          else next.delete(rows[k].id);
        }
      } else if (turnOn) next.add(id);
      else next.delete(id);
      return next;
    });
    anchor.current = i;
  }

  function toggleAll() {
    setPicked(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
    anchor.current = null;
  }

  /* ------------------------------------------------------------ bulk ops */

  const [bulkPicker, setBulkPicker] = useState<BulkPicker | null>(null);
  const [pending, startBulk] = useTransition();
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function apply(op: BulkOp) {
    const ids = [...selected];
    if (!ids.length) return;
    startBulk(async () => {
      try {
        const r = await bulkUpdate(ids, op);
        setToast(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Done" });
      } catch (err) {
        setToast({ text: err instanceof Error ? err.message : String(err), bad: true });
      }
    });
  }

  /* ------------------------------------------------------------- hotkeys */

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
  const bulk = selected.size > 0;
  useHotkeys({
    j: () => {
      if (cursor >= rows.length - 5) void loadMore();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    },
    k: () => setCursor((c) => Math.max(c - 1, 0)),
    ArrowDown: () => setCursor((c) => Math.min(c + 1, rows.length - 1)),
    ArrowUp: () => setCursor((c) => Math.max(c - 1, 0)),
    Enter: () => current && router.push(`/tickets/${current.number}`),
    o: () => current && router.push(`/tickets/${current.number}`),
    x: () => current && toggleRow(cursor, false),
    X: () => current && toggleRow(cursor, true),
    Escape: () => bulk && setPicked(new Set()),
    s: () => {
      if (bulk) apply({ kind: "star", add: selectedRows.some((r) => !starred.has(r.id)) });
      else if (current) star(current.id);
    },
    i: () => {
      if (bulk) apply({ kind: "assignee", agentId: me.id, add: true });
      else if (current && !mine.has(current.id))
        start(async () => {
          claim(current.id);
          await assignToMe(current.id);
        });
    },
    ...(bulk
      ? {
          a: () => setBulkPicker("assignee"),
          p: () => setBulkPicker("priority"),
          c: () => setBulkPicker("status"),
          t: () => setBulkPicker("tags"),
          m: () => setBulkPicker("team"),
        }
      : {}),
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

  // What the selection has in common, for the bulk pickers' checkmarks.
  const count = (pred: (r: TicketListItem) => boolean) => selectedRows.filter(pred).length;
  const split = (ids: string[], has: (r: TicketListItem, id: string) => boolean) => {
    const all: string[] = [];
    const some: string[] = [];
    for (const id of ids) {
      const n = count((r) => has(r, id));
      if (n === selectedRows.length && n > 0) all.push(id);
      else if (n > 0) some.push(id);
    }
    return { all, some };
  };
  const tagState = split(
    tags.map((t) => t.id),
    (r, id) => r.tags.some((t) => t.id === id),
  );
  const agentState = split(
    agents.map((a) => a.id),
    (r, id) => r.assignees.some((a) => a.id === id),
  );
  const common = <T,>(get: (r: TicketListItem) => T) => {
    const vals = new Set(selectedRows.map(get));
    return vals.size === 1 ? [...vals][0] : undefined;
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--muted)]/40 pl-3 pr-4 text-xs text-[var(--muted-foreground)]">
        <Checkbox
          checked={allSelected}
          partial={selected.size > 0 && !allSelected}
          onChange={toggleAll}
          label={allSelected ? "Deselect all" : "Select all"}
        />
        <span>
          {selected.size > 0
            ? `${selected.size} selected`
            : "Select tickets to change them together"}
        </span>
        {selected.size > 0 && !allSelected && (
          <button type="button" onClick={toggleAll} className="hover:text-[var(--foreground)] hover:underline">
            Select all {rows.length}{hasMore ? " loaded" : ""}
          </button>
        )}
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>x</Kbd> select · <Kbd>⇧</Kbd>+click range
        </span>
      </div>

      <ul ref={listRef} className={cn("flex-1 overflow-y-auto", bulk && "pb-20")}>
        {rows.map((t, i) => {
          const isStarred = starred.has(t.id);
          const isSelected = selected.has(t.id);
          const assigned =
            mine.has(t.id) && !t.assignees.some((a) => a.id === me.id)
              ? [...t.assignees, { id: me.id, name: me.name, email: me.email }]
              : t.assignees;
          const unsolved = t.status === "open" || t.status === "pending";
          const vip = t.tags.some(isVipTag);
          // VIP first, so it survives the two-tag limit below.
          const rowTags = vip ? [...t.tags].sort((a, b) => Number(isVipTag(b)) - Number(isVipTag(a))) : t.tags;

          return (
            <li key={t.id} data-row={i}>
              <div
                className={cn(
                  "group relative flex min-h-14 items-center gap-2.5 border-b border-[var(--border)] py-2 pl-3 pr-3 text-sm sm:h-12 sm:min-h-0 sm:gap-3 sm:py-0 sm:pr-4",
                  isSelected
                    ? "bg-[var(--primary)]/[0.07]"
                    : i === cursor
                      ? "bg-[var(--accent)]"
                      : "hover:bg-[var(--muted)]",
                )}
              >
                {i === cursor && (
                  <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--primary)]" aria-hidden />
                )}
                <Checkbox
                  checked={isSelected}
                  onChange={(e) => toggleRow(i, e.shiftKey)}
                  label={`Select #${t.number}`}
                  className="relative z-10"
                />
                <button
                  type="button"
                  onClick={() => star(t.id)}
                  className={cn(
                    "relative z-10 -ml-1 hidden rounded p-1 text-[var(--muted-foreground)] hover:text-amber-500 sm:block",
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
                <span className="hidden w-12 shrink-0 text-xs tabular-nums text-[var(--muted-foreground)] sm:inline">
                  #{t.number}
                </span>
                <span title={t.status} className="shrink-0">
                  <StatusIcon status={t.status} />
                </span>

                <Link
                  href={`/tickets/${t.number}`}
                  className="flex min-w-0 flex-1 items-center gap-2 after:absolute after:inset-0"
                  onFocus={() => setCursor(i)}
                  onClick={(e) => {
                    // While picking, a row click (or ⇧-click) selects instead of opening.
                    if (bulk || e.shiftKey) {
                      e.preventDefault();
                      toggleRow(i, e.shiftKey);
                    }
                  }}
                >
                  <Avatar
                    name={t.requesterName}
                    email={t.requesterEmail}
                    photo={photos[t.requesterEmail.toLowerCase()]}
                    size="xs"
                    className={cn("hidden sm:grid", vip && VIP_RING)}
                  />
                  <span className="hidden w-36 shrink-0 items-center gap-1 text-[var(--muted-foreground)] sm:flex">
                    <span className="truncate">{t.requesterName || t.requesterEmail}</span>
                    {vip && <VipMark />}
                  </span>
                  {/* Phones: subject over a "requester · #n" line. */}
                  <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2">
                    <span className={cn("truncate", unsolved ? "font-medium" : "text-[var(--muted-foreground)]")}>
                      {t.subject}
                    </span>
                    <span className="truncate text-xs text-[var(--muted-foreground)] sm:hidden">
                      {vip && <VipMark className="mr-1 align-[-2px]" />}
                      {t.requesterName || t.requesterEmail} · #{t.number}
                      {t.messageCount > 1 ? ` · ${t.messageCount} messages` : ""}
                    </span>
                  </span>
                  {t.messageCount > 1 && (
                    <span className="hidden shrink-0 text-xs text-[var(--muted-foreground)] sm:inline">
                      {t.messageCount}
                    </span>
                  )}
                </Link>

                <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
                  {rowTags.slice(0, 2).map((tag) => (
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
                  className="hidden w-14 shrink-0 justify-end sm:flex"
                  title={assigned.length ? `Assigned to ${assigned.map((a) => a.name).join(", ")}` : "Unassigned"}
                >
                  {assigned.length ? (
                    <span className="flex -space-x-1">
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
                {t.replyDueAt && <SlaPill dueAt={t.replyDueAt} className="hidden md:inline-flex" />}
                <AgeBadge
                  since={t.createdAt}
                  resolved={!unsolved}
                  dateClassName="hidden sm:inline"
                  className="justify-end sm:w-[136px]"
                />
              </div>
            </li>
          );
        })}
        {hasMore && (
          <li ref={sentinel} className="flex h-14 items-center justify-center text-xs text-[var(--muted-foreground)]">
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> Loading more…
              </span>
            ) : (
              <button type="button" onClick={loadMore} className="hover:underline">
                Showing {rows.length} of {total} · load more
              </button>
            )}
          </li>
        )}
      </ul>

      {bulk && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <div
            role="toolbar"
            aria-label="Bulk actions"
            className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 text-sm shadow-xl"
          >
            <span className="flex items-center gap-2 px-2 font-medium tabular-nums">
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {selected.size} selected
            </span>
            <span className="mx-1 h-5 w-px bg-[var(--border)]" />

            <Picker
              side="top"
              align="center"
              open={bulkPicker === "status"}
              onOpenChange={(o) => setBulkPicker(o ? "status" : null)}
              placeholder="Set status…"
              selected={[common((r) => r.status) ?? ""]}
              items={STATUSES.map((s) => ({ value: s.value, label: s.label, hint: s.hint, icon: <StatusIcon status={s.value} /> }))}
              onSelect={(v) => apply({ kind: "status", status: v as TicketStatus })}
              trigger={<BarButton k="c" icon={<StatusIcon status={common((r) => r.status) ?? "open"} />}>Status</BarButton>}
            />
            <Picker
              side="top"
              align="center"
              open={bulkPicker === "priority"}
              onOpenChange={(o) => setBulkPicker(o ? "priority" : null)}
              placeholder="Set priority…"
              selected={[common((r) => r.priority) ?? ""]}
              items={PRIORITIES.map((p) => ({ value: p.value, label: p.label, icon: <PriorityIcon priority={p.value} /> }))}
              onSelect={(v) => apply({ kind: "priority", priority: v as TicketPriority })}
              trigger={<BarButton k="p" icon={<PriorityIcon priority={common((r) => r.priority) ?? "none"} />}>Priority</BarButton>}
            />
            <Picker
              side="top"
              align="center"
              multi
              open={bulkPicker === "assignee"}
              onOpenChange={(o) => setBulkPicker(o ? "assignee" : null)}
              placeholder="Assign to…"
              emptyText="No agent matches"
              selected={agentState.all}
              partial={agentState.some}
              items={[
                {
                  value: "none",
                  label: "Unassign everyone",
                  icon: (
                    <span className="grid size-6 place-items-center rounded-full border border-dashed border-[var(--input)]">
                      <UserRound className="size-3.5 text-[var(--muted-foreground)]" />
                    </span>
                  ),
                },
                ...[...agents]
                  .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0))
                  .map((a) => ({
                    value: a.id,
                    label: a.id === me.id ? `${a.name} (you)` : a.name,
                    keywords: [a.email],
                    icon: <Avatar name={a.name} email={a.email} photo={photos[a.email.toLowerCase()]} size="sm" />,
                  })),
              ]}
              onSelect={(v) =>
                v === "none"
                  ? apply({ kind: "clearAssignees" })
                  : // Checked on every selected ticket → remove; otherwise add to all.
                    apply({ kind: "assignee", agentId: v, add: !agentState.all.includes(v) })
              }
              trigger={<BarButton k="a" icon={<UserRound className="size-3.5" />}>Assign</BarButton>}
            />
            <Picker
              side="top"
              align="center"
              open={bulkPicker === "team"}
              onOpenChange={(o) => setBulkPicker(o ? "team" : null)}
              placeholder="Move to team…"
              emptyText="No team matches"
              selected={[common((r) => r.teamId ?? "none") ?? ""]}
              items={[{ value: "none", label: "No team" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
              onSelect={(v) => apply({ kind: "team", teamId: v === "none" ? null : v })}
              trigger={<BarButton k="m" icon={<Users className="size-3.5" />}>Team</BarButton>}
            />
            <Picker
              side="top"
              align="center"
              multi
              open={bulkPicker === "tags"}
              onOpenChange={(o) => setBulkPicker(o ? "tags" : null)}
              placeholder="Add or remove tags…"
              emptyText="No tag matches"
              selected={tagState.all}
              partial={tagState.some}
              items={tags.map((t) => ({ value: t.id, label: t.name }))}
              onSelect={(v) => apply({ kind: "tag", tagId: v, add: !tagState.all.includes(v) })}
              trigger={<BarButton k="t" icon={<TagIcon className="size-3.5" />}>Tags</BarButton>}
            />
            <BarButton
              k="s"
              icon={<Star className="size-3.5" />}
              onClick={() => apply({ kind: "star", add: selectedRows.some((r) => !starred.has(r.id)) })}
            >
              {selectedRows.every((r) => starred.has(r.id)) ? "Unstar" : "Star"}
            </BarButton>

            <span className="mx-1 h-5 w-px bg-[var(--border)]" />
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="grid size-8 shrink-0 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label="Clear selection (Esc)"
              title="Clear selection (Esc)"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg px-3.5 py-2 text-sm shadow-lg",
            toast.bad
              ? "bg-[var(--destructive)] text-[var(--destructive-foreground)]"
              : "bg-[var(--foreground)] text-[var(--background)]",
          )}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Checkbox({
  checked,
  partial = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  partial?: boolean;
  onChange: (e: React.MouseEvent) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={partial ? "mixed" : checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded border transition-colors",
        checked || partial
          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "border-[var(--input)] bg-[var(--background)] hover:border-[var(--muted-foreground)]",
        className,
      )}
    >
      {checked ? (
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : partial ? (
        <span className="h-0.5 w-2 rounded bg-current" />
      ) : null}
    </button>
  );
}

type BarButtonProps = {
  icon: React.ReactNode;
  k: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/** Toolbar button; forwards its ref so it can anchor a picker popover. */
const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(
  { children, icon, k, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 hover:bg-[var(--accent)] data-[state=open]:bg-[var(--accent)]",
        className,
      )}
    >
      {icon}
      <span>{children}</span>
      <span className="ml-0.5 hidden md:inline-flex">
        <Kbd>{k}</Kbd>
      </span>
    </button>
  );
});
