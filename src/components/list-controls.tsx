"use client";

import { forwardRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, ChevronDown, X } from "lucide-react";
import { Picker, type PickerItem } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar";
import { TagDot } from "@/components/ui/badge";
import { PriorityIcon, StatusIcon } from "@/components/ui/ticket-icons";
import { saveView } from "@/lib/actions/views";
import { cn } from "@/lib/utils";

type SortOption = { value: string; label: string; defaultDir: "asc" | "desc" };
type Name = "status" | "priority" | "assignee" | "team" | "tag" | "sort";

/** Params that describe a list; everything else (focus, saved) is UI state. */
export const LIST_PARAMS = ["view", "status", "priority", "assignee", "team", "tag", "q", "sort", "dir"];

const FilterButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: React.ReactNode }
>(function FilterButton({ active, icon, children, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors data-[state=open]:bg-[var(--accent)]",
        active
          ? "border-[var(--primary)]/40 bg-[var(--primary)]/[0.07] text-[var(--foreground)]"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
        className,
      )}
    >
      {icon}
      {children}
      <ChevronDown className="size-3 opacity-60" />
    </button>
  );
});

/**
 * Filter + sort bar above the ticket list. Every choice lives in the URL, so
 * a view is just a link, and "Save view" stores that link under a name.
 */
export function ListControls({
  agents,
  teams,
  tags,
  sorts,
  me,
}: {
  agents: { id: string; name: string; email: string; photo: string | null }[];
  teams: { slug: string; name: string }[];
  tags: { slug: string; name: string; color: string }[];
  sorts: SortOption[];
  me: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<Name | null>(null);
  const [, start] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);

  const get = (k: string) => params.get(k) ?? "";
  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    next.delete("saved");
    next.delete("focus");
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // A status or assignee filter replaces the preset view's own constraint.
    if (("status" in changes || "assignee" in changes) && next.get("view") !== "starred") {
      next.set("view", "all");
    }
    start(() => router.replace(`${pathname}?${next}`));
  }

  const status = get("status");
  const priority = get("priority");
  const assignee = get("assignee");
  const team = get("team");
  const tag = get("tag");
  const sort = get("sort");
  const sortDef = sorts.find((s) => s.value === sort) ?? sorts[0];
  const dir = (get("dir") as "asc" | "desc") || sortDef.defaultDir;
  const filtered = !!(status || priority || assignee || team || tag || sort);

  const pick = (name: Name) => ({
    open: open === name,
    onOpenChange: (o: boolean) => setOpen(o ? name : null),
  });

  const agentName = assignee === "me" ? "Me" : assignee === "none" ? "Unassigned" : agents.find((a) => a.id === assignee)?.name;

  const agentItems: PickerItem[] = [
    { value: "", label: "Anyone" },
    { value: "me", label: "Me" },
    { value: "none", label: "Unassigned" },
    ...agents
      .filter((a) => a.id !== me)
      .map((a) => ({
        value: a.id,
        label: a.name,
        keywords: [a.email],
        icon: <Avatar name={a.name} email={a.email} photo={a.photo} size="xs" />,
      })),
  ];

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border)] px-3 sm:px-5">
      <Picker
        {...pick("status")}
        placeholder="Status…"
        selected={[status]}
        items={[
          { value: "", label: "Any status" },
          { value: "unsolved", label: "Unsolved", hint: "Open + pending" },
          ...(["open", "pending", "solved", "closed"] as const).map((s) => ({
            value: s,
            label: s[0].toUpperCase() + s.slice(1),
            icon: <StatusIcon status={s} />,
          })),
        ]}
        onSelect={(v) => update({ status: v || null })}
        trigger={
          <FilterButton active={!!status} icon={status && status !== "unsolved" ? <StatusIcon status={status} /> : undefined}>
            {status ? status[0].toUpperCase() + status.slice(1) : "Status"}
          </FilterButton>
        }
      />
      <Picker
        {...pick("priority")}
        placeholder="Priority…"
        selected={[priority]}
        items={[
          { value: "", label: "Any priority" },
          ...(["p0", "p1", "p2", "p3", "none"] as const).map((p) => ({
            value: p,
            label: p === "none" ? "No priority" : p.toUpperCase(),
            icon: <PriorityIcon priority={p} />,
          })),
        ]}
        onSelect={(v) => update({ priority: v || null })}
        trigger={
          <FilterButton active={!!priority} icon={priority ? <PriorityIcon priority={priority} /> : undefined}>
            {priority ? (priority === "none" ? "No priority" : "Priority") : "Priority"}
          </FilterButton>
        }
      />
      <Picker
        {...pick("assignee")}
        placeholder="Assigned to…"
        selected={[assignee]}
        items={agentItems}
        onSelect={(v) => update({ assignee: v || null })}
        trigger={<FilterButton active={!!assignee}>{agentName ?? "Assignee"}</FilterButton>}
      />
      <Picker
        {...pick("team")}
        placeholder="Team…"
        selected={[team]}
        items={[{ value: "", label: "Any team" }, ...teams.map((t) => ({ value: t.slug, label: t.name }))]}
        onSelect={(v) => update({ team: v || null })}
        trigger={<FilterButton active={!!team}>{teams.find((t) => t.slug === team)?.name ?? "Team"}</FilterButton>}
      />
      <Picker
        {...pick("tag")}
        placeholder="Tag…"
        selected={[tag]}
        items={[
          { value: "", label: "Any tag" },
          ...tags.map((t) => ({ value: t.slug, label: t.name, icon: <TagDot color={t.color} /> })),
        ]}
        onSelect={(v) => update({ tag: v || null })}
        trigger={
          <FilterButton
            active={!!tag}
            icon={tag ? <TagDot color={tags.find((t) => t.slug === tag)?.color ?? "slate"} /> : undefined}
          >
            {tags.find((t) => t.slug === tag)?.name ?? "Tag"}
          </FilterButton>
        }
      />

      <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border)]" />

      <Picker
        {...pick("sort")}
        placeholder="Sort by…"
        selected={[sortDef.value]}
        items={sorts.map((s) => ({ value: s.value, label: s.label }))}
        onSelect={(v) => update({ sort: v === "activity" ? null : v, dir: null })}
        trigger={<FilterButton active={!!sort}>Sort: {sortDef.label}</FilterButton>}
      />
      <button
        type="button"
        onClick={() => update({ dir: dir === "asc" ? "desc" : "asc", sort: sort || null })}
        className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        title={dir === "asc" ? "Ascending (oldest / A→Z first)" : "Descending (newest / Z→A first)"}
        aria-label="Reverse sort order"
      >
        {dir === "asc" ? <ArrowUpNarrowWide className="size-3.5" /> : <ArrowDownWideNarrow className="size-3.5" />}
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        {filtered && (
          <button
            type="button"
            onClick={() => update({ status: null, priority: null, assignee: null, team: null, tag: null, sort: null, dir: null })}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X className="size-3" /> Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const name = window.prompt("Name this view", "");
            if (!name?.trim()) return;
            const q = new URLSearchParams();
            for (const k of LIST_PARAMS) if (params.get(k)) q.set(k, params.get(k)!);
            start(async () => {
              const r = await saveView(name, q.toString());
              setSaved(r.error ?? "Saved to your sidebar");
              setTimeout(() => setSaved(null), 2500);
            });
          }}
          className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Save these filters as a view in your sidebar"
        >
          <Bookmark className="size-3.5" />
          {saved ?? "Save view"}
        </button>
      </div>
    </div>
  );
}
