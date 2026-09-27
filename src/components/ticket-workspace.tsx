"use client";

import {
  createContext,
  useContext,
  useEffect,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, Tag as TagIcon, UserRound, Users } from "lucide-react";
import {
  clearAssignees,
  toggleAssignee,
  setPriority,
  setStatus,
  setTeam,
  toggleStar,
  toggleTag,
  type ActionState,
} from "@/lib/actions/tickets";
import type { TicketPriority, TicketStatus } from "@/db/schema";
import { useHotkeys } from "@/lib/hotkeys";
import { Avatar, PersonChip } from "@/components/ui/avatar";
import { Picker, type PickerItem } from "@/components/ui/picker";
import { TagBadge } from "@/components/ui/badge";
import {
  PRIORITIES,
  PriorityIcon,
  STATUSES,
  StatusIcon,
} from "@/components/ui/ticket-icons";
import { Kbd } from "@/components/shortcuts";
import { cn } from "@/lib/utils";

export type AgentOption = { id: string; name: string; email: string; photo: string | null };
export type TeamOption = { id: string; name: string };
export type TagOption = { id: string; name: string; color: string };

type Snapshot = {
  status: TicketStatus;
  priority: TicketPriority;
  assigneeIds: string[];
  teamId: string | null;
  tagIds: string[];
  starred: boolean;
};

type PickerName = "status" | "priority" | "assignee" | "team" | "tags";

type Ctx = {
  ticketId: string;
  state: Snapshot;
  me: string;
  agents: AgentOption[];
  teams: TeamOption[];
  tags: TagOption[];
  picker: PickerName | null;
  setPicker: (p: PickerName | null) => void;
  mutate: (patch: Partial<Snapshot>, run: () => Promise<ActionState>, announce?: boolean) => void;
};

const TicketCtx = createContext<Ctx | null>(null);

function useTicket() {
  const ctx = useContext(TicketCtx);
  if (!ctx) throw new Error("useTicket outside TicketProvider");
  return ctx;
}

/**
 * Holds the ticket's editable properties with optimistic updates: a change
 * shows instantly, the server action runs in a transition, and the refreshed
 * server props take over when it lands (or the change rolls back on error).
 */
export function TicketProvider({
  ticketId,
  initial,
  me,
  agents,
  teams,
  tags,
  children,
}: {
  ticketId: string;
  initial: Snapshot;
  me: string;
  agents: AgentOption[];
  teams: TeamOption[];
  tags: TagOption[];
  children: React.ReactNode;
}) {
  const [state, apply] = useOptimistic(initial, (s: Snapshot, patch: Partial<Snapshot>) => ({
    ...s,
    ...patch,
  }));
  const [, start] = useTransition();
  const [picker, setPicker] = useState<PickerName | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  function mutate(patch: Partial<Snapshot>, run: () => Promise<ActionState>, announce = false) {
    start(async () => {
      apply(patch);
      try {
        const r = await run();
        if (r.error) setToast({ text: r.error, bad: true });
        else if (announce && r.ok) setToast({ text: r.ok });
      } catch (err) {
        setToast({ text: err instanceof Error ? err.message : String(err), bad: true });
      }
    });
  }

  return (
    <TicketCtx.Provider
      value={{ ticketId, state, me, agents, teams, tags, picker, setPicker, mutate }}
    >
      {children}
      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg px-3.5 py-2 text-sm shadow-lg",
            toast.bad
              ? "bg-[var(--destructive)] text-[var(--destructive-foreground)]"
              : "bg-[var(--foreground)] text-[var(--background)]",
          )}
        >
          {toast.text}
        </div>
      )}
    </TicketCtx.Provider>
  );
}

/* ------------------------------------------------------------------ star */

export function StarButton() {
  const { ticketId, state, mutate } = useTicket();
  return (
    <button
      type="button"
      onClick={() => mutate({ starred: !state.starred }, () => toggleStar(ticketId))}
      className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
      aria-pressed={state.starred}
      title={state.starred ? "Unstar (s)" : "Star (s)"}
    >
      <Star
        className={cn("size-[18px]", state.starred && "fill-amber-400 text-amber-400")}
      />
    </button>
  );
}

/* ------------------------------------------------------------ properties */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-start gap-2">
      <span className="pt-2 text-xs text-[var(--muted-foreground)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const triggerClass =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-[var(--accent)] data-[state=open]:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

function Hint({ k }: { k: string }) {
  return (
    <span className="ml-auto hidden shrink-0 opacity-0 transition-opacity group-hover:opacity-100 lg:inline-flex">
      <Kbd>{k}</Kbd>
    </span>
  );
}

export function TicketProperties() {
  const { ticketId, state, agents, teams, tags, picker, setPicker, mutate, me } = useTicket();
  const open = (name: PickerName) => (o: boolean) => setPicker(o ? name : null);

  const assignees = state.assigneeIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is AgentOption => !!a);
  const team = teams.find((t) => t.id === state.teamId) ?? null;
  const activeTags = tags.filter((t) => state.tagIds.includes(t.id));
  const status = STATUSES.find((s) => s.value === state.status)!;
  const priority = PRIORITIES.find((p) => p.value === state.priority)!;

  const agentItems: PickerItem[] = [
    ...(state.assigneeIds.length ? [{
      value: "none",
      label: "Unassign everyone",
      icon: (
        <span className="grid size-6 place-items-center rounded-full border border-dashed border-[var(--input)]">
          <UserRound className="size-3.5 text-[var(--muted-foreground)]" />
        </span>
      ),
    }] : []),
    ...[...agents]
      // You first, since assigning to yourself is the common case.
      .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0))
      .map((a) => ({
        value: a.id,
        label: a.id === me ? `${a.name} (you)` : a.name,
        keywords: [a.email],
        icon: <Avatar name={a.name} email={a.email} photo={a.photo} size="sm" />,
      })),
  ];

  return (
    <div className="space-y-1">
      <Row label="Status">
        <Picker
          open={picker === "status"}
          onOpenChange={open("status")}
          placeholder="Change status…"
          selected={[state.status]}
          items={STATUSES.map((s) => ({
            value: s.value,
            label: s.label,
            icon: <StatusIcon status={s.value} />,
          }))}
          onSelect={(v) =>
            mutate({ status: v as TicketStatus }, () => setStatus(ticketId, v as TicketStatus))
          }
          trigger={
            <button type="button" className={cn(triggerClass, "group")}>
              <StatusIcon status={status.value} />
              <span>{status.label}</span>
              <Hint k="c" />
            </button>
          }
        />
      </Row>

      <Row label="Priority">
        <Picker
          open={picker === "priority"}
          onOpenChange={open("priority")}
          placeholder="Set priority…"
          selected={[state.priority]}
          items={PRIORITIES.map((p) => ({
            value: p.value,
            label: p.label,
            icon: <PriorityIcon priority={p.value} />,
          }))}
          onSelect={(v) =>
            mutate({ priority: v as TicketPriority }, () =>
              setPriority(ticketId, v as TicketPriority),
            )
          }
          trigger={
            <button type="button" className={cn(triggerClass, "group")}>
              <PriorityIcon priority={priority.value} />
              <span className={cn(priority.value === "none" && "text-[var(--muted-foreground)]")}>
                {priority.label}
              </span>
              <Hint k="p" />
            </button>
          }
        />
      </Row>

      <Row label="Assignees">
        <Picker
          open={picker === "assignee"}
          onOpenChange={open("assignee")}
          placeholder="Assign to…"
          emptyText="No agent matches"
          multi
          selected={state.assigneeIds}
          items={agentItems}
          onSelect={(v) => {
            if (v === "none") {
              mutate({ assigneeIds: [] }, () => clearAssignees(ticketId));
              return;
            }
            const next = state.assigneeIds.includes(v)
              ? state.assigneeIds.filter((id) => id !== v)
              : [...state.assigneeIds, v];
            mutate({ assigneeIds: next }, () => toggleAssignee(ticketId, v));
          }}
          trigger={
            <button type="button" className={cn(triggerClass, "group h-auto min-h-8 py-1")}>
              {assignees.length === 0 ? (
                <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
                  <span className="grid size-6 place-items-center rounded-full border border-dashed border-[var(--input)]">
                    <UserRound className="size-3.5" />
                  </span>
                  Unassigned
                </span>
              ) : assignees.length === 1 ? (
                <PersonChip
                  name={assignees[0].name}
                  email={assignees[0].email}
                  photo={assignees[0].photo}
                />
              ) : (
                <span className="flex min-w-0 flex-col gap-1.5 py-0.5">
                  {assignees.map((a) => (
                    <PersonChip key={a.id} name={a.name} email={a.email} photo={a.photo} />
                  ))}
                </span>
              )}
              <Hint k="a" />
            </button>
          }
        />
      </Row>

      <Row label="Team">
        <Picker
          open={picker === "team"}
          onOpenChange={open("team")}
          placeholder="Move to team…"
          emptyText="No team matches"
          selected={[state.teamId ?? "none"]}
          items={[
            { value: "none", label: "No team" },
            ...teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
          onSelect={(v) => {
            const id = v === "none" ? null : v;
            mutate({ teamId: id }, () => setTeam(ticketId, id));
          }}
          trigger={
            <button type="button" className={cn(triggerClass, "group")}>
              <Users className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
              <span className={cn("truncate", !team && "text-[var(--muted-foreground)]")}>
                {team?.name ?? "No team"}
              </span>
              <Hint k="m" />
            </button>
          }
        />
      </Row>

      <Row label="Tags">
        <Picker
          open={picker === "tags"}
          onOpenChange={open("tags")}
          placeholder="Add or remove tags…"
          emptyText="No tag matches"
          multi
          selected={state.tagIds}
          items={tags.map((t) => ({ value: t.id, label: t.name }))}
          onSelect={(v) => {
            const next = state.tagIds.includes(v)
              ? state.tagIds.filter((id) => id !== v)
              : [...state.tagIds, v];
            mutate({ tagIds: next }, () => toggleTag(ticketId, v));
          }}
          trigger={
            <button
              type="button"
              className={cn(triggerClass, "group h-auto min-h-8 flex-wrap py-1.5")}
            >
              {activeTags.length ? (
                activeTags.map((t) => <TagBadge key={t.id} name={t.name} color={t.color} />)
              ) : (
                <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
                  <TagIcon className="size-3.5" />
                  Add tags
                </span>
              )}
              {activeTags.length > 0 && (
                <Plus className="size-3.5 text-[var(--muted-foreground)]" />
              )}
              <Hint k="t" />
            </button>
          }
        />
      </Row>
    </div>
  );
}

/* ---------------------------------------------------------------- hotkeys */

export function TicketHotkeys({
  newer,
  older,
}: {
  newer: number | null;
  older: number | null;
}) {
  const router = useRouter();
  const { ticketId, state, me, setPicker, mutate } = useTicket();

  useHotkeys({
    s: () => mutate({ starred: !state.starred }, () => toggleStar(ticketId), true),
    a: () => setPicker("assignee"),
    i: () => {
      if (state.assigneeIds.includes(me)) return;
      mutate(
        { assigneeIds: [...state.assigneeIds, me] },
        () => toggleAssignee(ticketId, me, "add"),
        true,
      );
    },
    p: () => setPicker("priority"),
    c: () => setPicker("status"),
    t: () => setPicker("tags"),
    m: () => setPicker("team"),
    e: () => mutate({ status: "solved" }, () => setStatus(ticketId, "solved"), true),
    // j/k follow the list order: j goes down (older), k goes up (newer).
    j: () => older && router.push(`/tickets/${older}`),
    k: () => newer && router.push(`/tickets/${newer}`),
    u: () => router.push("/tickets"),
    Escape: () => router.push("/tickets"),
  });

  return null;
}
