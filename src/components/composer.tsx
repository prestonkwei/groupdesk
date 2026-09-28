"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Lock, Reply, Send, StickyNote } from "lucide-react";
import { addNote, replyToTicket, type ActionState } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/shortcuts";
import {
  RichEditor,
  type MentionOption,
  type RichValue,
  type TemplateOption,
} from "@/components/rich-editor";
import { firstNameOf, recipientVars } from "@/lib/template-vars";
import { RecipientField, type Contact } from "@/components/recipient-field";
import { useHotkeys } from "@/lib/hotkeys";
import { useTicketPresence } from "@/components/ticket-workspace";
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
  templates,
  ticketNumber,
  ticketSubject,
  agents,
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
  templates: TemplateOption[];
  ticketNumber: number;
  ticketSubject: string;
  agents: MentionOption[];
}) {
  const [mode, setMode] = useState<Mode>("reply");
  const [open, setOpen] = useState(false);
  const presence = useTicketPresence();
  const setReplying = presence?.setReplying;
  const othersReplying = (presence?.viewers ?? []).filter((v) => v.replying);

  // Tell other agents on this ticket that a reply is being written.
  useEffect(() => {
    setReplying?.(open && mode === "reply");
    return () => setReplying?.(false);
  }, [open, mode, setReplying]);
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
    <div className="border-t border-[var(--border)] bg-[var(--background)] px-3 py-3 sm:px-6">
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

        {mode === "reply" && othersReplying.length > 0 && (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {othersReplying.map((v) => v.name).join(" and ")}{" "}
            {othersReplying.length === 1 ? "is" : "are"} replying to this ticket right now.
          </p>
        )}
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
              mode === "reply"
                ? "Write your reply… (type / for templates)"
                : "Note for the team — type @ to mention someone"
            }
            templates={templates}
            // "@" suggests teammates in internal notes (they get an email).
            mentions={mode === "note" ? agents : undefined}
            variables={() => {
              // Variables describe the first To recipient.
              const email = to[0] ?? "";
              const known = contacts.find((c) => c.email === email);
              return recipientVars(
                { email, name: known?.name ?? (email === defaultTo[0] ? requesterName : null) },
                {
                  ticket_number: String(ticketNumber),
                  subject: ticketSubject,
                  agent_name: fromName,
                  agent_first_name: firstNameOf(fromName),
                },
              );
            }}
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
