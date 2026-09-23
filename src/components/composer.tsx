"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Send, StickyNote } from "lucide-react";
import { addNote, replyToTicket, type ActionState } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function SubmitButton({ mode }: { mode: "reply" | "note" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {mode === "reply" ? <Send /> : <StickyNote />}
      {pending
        ? mode === "reply"
          ? "Sending…"
          : "Saving…"
        : mode === "reply"
          ? "Send reply"
          : "Save note"}
    </Button>
  );
}

export function Composer({
  ticketId,
  requesterEmail,
  groupEmail,
}: {
  ticketId: string;
  requesterEmail: string;
  groupEmail: string;
}) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action] = useActionState<ActionState, FormData>(
    async (prev, form) =>
      mode === "reply" ? replyToTicket(prev, form) : addNote(prev, form),
    {},
  );

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <div className="border-t border-[var(--border)] bg-[var(--background)] p-4">
      <div className="mb-2 flex items-center gap-1">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              mode === m
                ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
            )}
          >
            {m === "reply" ? "Reply" : "Internal note"}
          </button>
        ))}
        <span className="ml-2 truncate text-xs text-[var(--muted-foreground)]">
          {mode === "reply"
            ? `To ${requesterEmail} · cc ${groupEmail}`
            : "Only visible in this portal"}
        </span>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <Textarea
          name="body"
          required
          placeholder={
            mode === "reply"
              ? "Write your reply…"
              : "Note for the team — not emailed to anyone"
          }
          className={cn(
            mode === "note" &&
              "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
          )}
        />
        <div className="flex items-center gap-3">
          <SubmitButton mode={mode} />
          {state.error && (
            <span className="text-xs text-[var(--destructive)]">{state.error}</span>
          )}
          {state.ok && (
            <span className="text-xs text-[var(--muted-foreground)]">{state.ok}</span>
          )}
        </div>
      </form>
    </div>
  );
}
