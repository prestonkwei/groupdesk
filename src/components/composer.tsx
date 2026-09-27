"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Lock, Reply, Send, StickyNote } from "lucide-react";
import { addNote, replyToTicket, type ActionState } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/shortcuts";
import { RichEditor, type RichValue } from "@/components/rich-editor";
import { RecipientField, type Contact } from "@/components/recipient-field";
import { useHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

type Mode = "reply" | "note";

function SubmitButton({ mode, disabled }: { mode: Mode; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {mode === "reply" ? <Send /> : <StickyNote />}
      {pending
        ? mode === "reply"
          ? "Sending…"
          : "Saving…"
        : mode === "reply"
          ? "Send reply"
          : "Save note"}
      {!pending && <span className="ml-1 hidden text-[11px] opacity-70 sm:inline">⌘↵</span>}
    </Button>
  );
}

const EMPTY: RichValue = { html: "", text: "", empty: true };

export function Composer({
  ticketId,
  subject,
  fromName,
  fromEmail,
  requesterName,
  defaultTo,
  defaultCc,
  contacts,
}: {
  ticketId: string;
  /** Exactly what the reply's Subject will be, e.g. "[TICKET: #1058] …". */
  subject: string;
  fromName: string;
  fromEmail: string;
  requesterName: string;
  defaultTo: string[];
  defaultCc: string[];
  contacts: Contact[];
}) {
  const [mode, setMode] = useState<Mode>("reply");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<RichValue>(EMPTY);
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action] = useActionState<ActionState, FormData>(async (prev, form) => {
    const result =
      mode === "reply" ? await replyToTicket(prev, form) : await addNote(prev, form);
    if (result.ok) {
      setBody(EMPTY);
      setResetKey((k) => k + 1);
      setBcc([]);
      setShowBcc(false);
      setOpen(false);
    }
    return result;
  }, {});

  function start(m: Mode) {
    setMode(m);
    setOpen(true);
    setFocusKey((k) => k + 1);
  }

  useHotkeys({ r: () => start("reply"), n: () => start("note") });

  return (
    <div className="border-t border-[var(--border)] bg-[var(--background)] px-6 py-3">
      {!open && (
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => start("reply")}
              className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-left text-sm text-[var(--muted-foreground)] hover:border-[var(--input)] hover:bg-[var(--muted)]"
            >
              <Reply className="size-4 shrink-0" />
              <span className="truncate">
                {body.empty ? `Reply to ${requesterName}…` : `Draft: ${body.text.slice(0, 90)}`}
              </span>
              <span className="ml-auto">
                <Kbd>r</Kbd>
              </span>
            </button>
            <button
              type="button"
              onClick={() => start("note")}
              className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--muted-foreground)] hover:border-[var(--input)] hover:bg-[var(--muted)]"
            >
              <StickyNote className="size-4" />
              <span className="hidden sm:inline">Note</span>
              <Kbd>n</Kbd>
            </button>
          </div>
          {state.ok && (
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">{state.ok}</p>
          )}
        </div>
      )}

      {/* Stays mounted while collapsed so a draft survives Cancel/Esc. */}
      <form
        ref={formRef}
        action={action}
        className={cn("mx-auto w-full max-w-3xl", !open && "hidden")}
      >
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="body" value={body.text} />
        <input type="hidden" name="bodyHtml" value={body.empty ? "" : body.html} />
        <input type="hidden" name="to" value={JSON.stringify(to)} />
        <input type="hidden" name="cc" value={JSON.stringify(cc)} />
        <input type="hidden" name="bcc" value={JSON.stringify(bcc)} />

        <div className="mb-2 flex items-center gap-1">
          {(["reply", "note"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => start(m)}
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
          {mode === "note" && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
              <Lock className="size-3" /> Only visible to agents, never emailed
            </span>
          )}
        </div>

        <div
          className={cn(
            "overflow-visible rounded-lg border shadow-sm focus-within:ring-2 focus-within:ring-[var(--ring)]",
            mode === "note"
              ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
              : "border-[var(--input)] bg-[var(--card)]",
          )}
        >
          {mode === "reply" && (
            <>
              <div className="flex min-h-9 items-center gap-2 border-b border-[var(--border)] px-3 text-sm">
                <span className="w-8 shrink-0 text-xs text-[var(--muted-foreground)]">From</span>
                <span className="min-w-0 truncate">
                  {fromName}{" "}
                  <span className="text-[var(--muted-foreground)]">&lt;{fromEmail}&gt;</span>
                </span>
                {!showBcc && (
                  <button
                    type="button"
                    onClick={() => setShowBcc(true)}
                    className="ml-auto shrink-0 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    Bcc
                  </button>
                )}
              </div>
              <RecipientField label="To" value={to} onChange={setTo} contacts={contacts} />
              <RecipientField label="Cc" value={cc} onChange={setCc} contacts={contacts} />
              {showBcc && (
                <RecipientField
                  label="Bcc"
                  value={bcc}
                  onChange={setBcc}
                  contacts={contacts}
                  autoFocus
                />
              )}
              <div className="flex min-h-9 items-center gap-2 border-b border-[var(--border)] px-3 text-sm">
                <span className="w-8 shrink-0 text-xs text-[var(--muted-foreground)]">Subj</span>
                <span className="min-w-0 truncate text-[var(--muted-foreground)]">{subject}</span>
              </div>
            </>
          )}

          <RichEditor
            placeholder={
              mode === "reply" ? "Write your reply…" : "Note for the team — not emailed to anyone"
            }
            onChange={setBody}
            onSubmit={() => formRef.current?.requestSubmit()}
            onEscape={() => setOpen(false)}
            autoFocusKey={focusKey}
            resetKey={resetKey}
          />
        </div>

        <div className="mt-2 flex items-center gap-3">
          <SubmitButton mode={mode} disabled={body.empty || (mode === "reply" && !to.length)} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Close
          </button>
          {state.error && (
            <span className="text-xs text-[var(--destructive)]">{state.error}</span>
          )}
        </div>
      </form>
    </div>
  );
}
