"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

function Status({ state }: { state: ActionState }) {
  if (state.error)
    return <span className="text-xs text-[var(--destructive)]">{state.error}</span>;
  if (state.ok)
    return <span className="text-xs text-[var(--muted-foreground)]">{state.ok}</span>;
  return null;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/* ---------------------------------------------------------------- agents */

export function AddAgentForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={formAction} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Name" required className="w-40" />
      <Input
        name="email"
        type="email"
        placeholder="email@example.org"
        required
        className="w-64"
      />
      <Select name="role" defaultValue="agent" className="w-28">
        <option value="agent">Agent</option>
        <option value="admin">Admin</option>
      </Select>
      <Submit label="Add agent" />
      <Status state={state} />
    </form>
  );
}

export function ToggleAgentForm({
  action,
  id,
  active,
}: {
  action: Action;
  id: string;
  active: boolean;
}) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {active ? "Deactivate" : "Reactivate"}
      </Button>
    </form>
  );
}

/** One tiny form per team, so the on/off value is a plain hidden field. */
export function AgentTeamToggles({
  action,
  agentId,
  teams,
  memberOf,
}: {
  action: Action;
  agentId: string;
  teams: { id: string; name: string }[];
  memberOf: string[];
}) {
  if (!teams.length)
    return <span className="text-xs text-[var(--muted-foreground)]">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {teams.map((t) => (
        <TeamToggle
          key={t.id}
          action={action}
          agentId={agentId}
          team={t}
          on={memberOf.includes(t.id)}
        />
      ))}
    </div>
  );
}

function TeamToggle({
  action,
  agentId,
  team,
  on,
}: {
  action: Action;
  agentId: string;
  team: { id: string; name: string };
  on: boolean;
}) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="teamId" value={team.id} />
      <input type="hidden" name="on" value={String(!on)} />
      <button
        type="submit"
        disabled={pending}
        className={
          on
            ? "rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs text-[var(--primary-foreground)] disabled:opacity-50"
            : "rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
        }
      >
        {team.name}
      </button>
    </form>
  );
}

/* ------------------------------------------------------- teams and tags */

export function NameForm({
  action,
  label,
  placeholder,
  colors,
}: {
  action: Action;
  label: string;
  placeholder: string;
  colors?: string[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={formAction} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder={placeholder} required className="w-64" />
      {colors && (
        <Select name="color" defaultValue={colors[0]} className="w-32 capitalize">
          {colors.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      )}
      <Submit label={label} />
      <Status state={state} />
    </form>
  );
}

export function DeleteForm({ action, id }: { action: Action; id: string }) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Delete
      </Button>
    </form>
  );
}

/* ----------------------------------------------------------------- gmail */

export function PlainActionButton({
  action,
  label,
  variant = "outline",
}: {
  action: () => Promise<ActionState>;
  label: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async () => action(),
    {},
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {pending ? "Working…" : label}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function DisconnectForm({
  action,
  email,
}: {
  action: Action;
  email: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    {},
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="email" value={email} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Disconnect
      </Button>
      <Status state={state} />
    </form>
  );
}

/* -------------------------------------------------------------- backfill */

type BackfillResult =
  | { matched: number; ingested: number; skipped: number; failed: number; remaining: number; firstError: string | null }
  | { error: string };

export function BackfillForm({
  action,
  defaultQuery,
}: {
  action: (input: { query: string; after?: string }) => Promise<BackfillResult>;
  defaultQuery: string;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  async function run(form: FormData) {
    const query = String(form.get("query") ?? "");
    const after = String(form.get("after") ?? "");
    stop.current = false;
    setRunning(true);
    setError(null);
    setProgress("Listing matching mail…");

    let imported = 0;
    let failed = 0;
    try {
      // Each call imports for up to ~4 minutes; keep going until nothing is left.
      while (!stop.current) {
        const r = await action({ query, after });
        if ("error" in r) {
          setError(r.error);
          break;
        }
        imported += r.ingested + r.skipped;
        failed += r.failed;
        if (r.firstError) setError(`Some messages failed: ${r.firstError}`);
        setProgress(
          `${r.matched} matched · ${imported} imported this run · ${r.remaining} left` +
            (failed ? ` · ${failed} failed` : ""),
        );
        // Done, or a batch that made no progress (only failures): stop looping.
        if (r.remaining === 0 || r.ingested + r.skipped === 0) break;
      }
      if (stop.current) setProgress((p) => `${p ?? ""} · stopped`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <form action={run} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="query"
          defaultValue={defaultQuery}
          required
          disabled={running}
          className="w-72"
          aria-label="Gmail search"
        />
        <Input
          name="after"
          type="date"
          disabled={running}
          className="w-40"
          aria-label="Only mail after"
        />
        {running ? (
          <Button type="button" size="sm" variant="outline" onClick={() => (stop.current = true)}>
            Stop after this batch
          </Button>
        ) : (
          <Button type="submit" size="sm">
            Backfill
          </Button>
        )}
      </div>
      {progress && <p className="text-xs text-[var(--muted-foreground)]">{progress}</p>}
      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
    </form>
  );
}
