"use client";

import { useActionState } from "react";
import {
  assignTicket,
  setStatus,
  setTeam,
  toggleTag,
  type ActionState,
} from "@/lib/actions/tickets";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };
type TagOption = Option & { color: string };

/** A <select> that submits its form the moment it changes. */
function AutoSelect({
  action,
  ticketId,
  name,
  value,
  options,
  emptyLabel,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  ticketId: string;
  name: string;
  value: string | null;
  options: Option[];
  emptyLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <Select
        name={name}
        defaultValue={value ?? "none"}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 text-xs"
      >
        {emptyLabel && <option value="none">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      {state.error && (
        <p className="mt-1 text-xs text-[var(--destructive)]">{state.error}</p>
      )}
    </form>
  );
}

export function TicketControls({
  ticketId,
  status,
  assigneeId,
  teamId,
  agents,
  teams,
  tags,
  activeTagIds,
}: {
  ticketId: string;
  status: string;
  assigneeId: string | null;
  teamId: string | null;
  agents: Option[];
  teams: Option[];
  tags: TagOption[];
  activeTagIds: string[];
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <Field label="Status">
        <AutoSelect
          action={setStatus}
          ticketId={ticketId}
          name="status"
          value={status}
          options={[
            { id: "open", name: "Open" },
            { id: "pending", name: "Pending" },
            { id: "solved", name: "Solved" },
            { id: "closed", name: "Closed" },
          ]}
        />
      </Field>

      <Field label="Assignee">
        <AutoSelect
          action={assignTicket}
          ticketId={ticketId}
          name="assigneeId"
          value={assigneeId}
          options={agents}
          emptyLabel="Unassigned"
        />
      </Field>

      <Field label="Team">
        <AutoSelect
          action={setTeam}
          ticketId={ticketId}
          name="teamId"
          value={teamId}
          options={teams}
          emptyLabel="No team"
        />
      </Field>

      <Field label="Tags">
        <TagToggles
          ticketId={ticketId}
          tags={tags}
          activeTagIds={activeTagIds}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </p>
      {children}
    </div>
  );
}

function TagToggles({
  ticketId,
  tags,
  activeTagIds,
}: {
  ticketId: string;
  tags: TagOption[];
  activeTagIds: string[];
}) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(
    toggleTag,
    {},
  );

  if (tags.length === 0) {
    return <p className="text-[var(--muted-foreground)]">No tags defined yet.</p>;
  }

  return (
    <form action={formAction} className="flex flex-wrap gap-1.5">
      <input type="hidden" name="ticketId" value={ticketId} />
      {tags.map((t) => {
        const on = activeTagIds.includes(t.id);
        return (
          <button
            key={t.id}
            type="submit"
            name="tagId"
            value={t.id}
            disabled={pending}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50",
              on
                ? "border-transparent bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
            )}
          >
            {t.name}
          </button>
        );
      })}
    </form>
  );
}
