"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { startTicket } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { RichEditor, type RichValue, type TemplateOption } from "@/components/rich-editor";
import { firstNameOf, recipientVars } from "@/lib/template-vars";
import { RecipientField, type Contact } from "@/components/recipient-field";
import { TICKET_TAG } from "@/lib/ticket-subject";

/**
 * Compose an email that starts a new ticket. The ticket number isn't known
 * until it's created, so the subject shows "[TICKET: #…]" as a fixed prefix.
 */
export function NewMessageForm({
  fromName,
  fromEmail,
  defaultTo,
  defaultCc,
  contacts,
  templates,
}: {
  fromName: string;
  fromEmail: string;
  defaultTo: string[];
  defaultCc: string[];
  contacts: Contact[];
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState<RichValue>({ html: "", text: "", empty: true });
  const [assignToMe, setAssignToMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ready = to.length > 0 && subject.trim() && !body.empty;

  function send() {
    if (!ready || pending) return;
    setError(null);
    start(async () => {
      const r = await startTicket({
        to,
        cc,
        bcc,
        subject,
        bodyText: body.text,
        bodyHtml: body.html,
        assignToMe,
      });
      if (r.error || !r.number) setError(r.error ?? "Send failed");
      else router.push(`/tickets/${r.number}`);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-6"
    >
      <div className="overflow-visible rounded-lg border border-[var(--input)] bg-[var(--card)] shadow-sm focus-within:ring-2 focus-within:ring-[var(--ring)]">
        <div className="flex min-h-9 items-center gap-2 border-b border-[var(--border)] px-3 text-sm">
          <span className="w-8 shrink-0 text-xs text-[var(--muted-foreground)]">From</span>
          <span className="min-w-0 truncate">
            {fromName} <span className="text-[var(--muted-foreground)]">&lt;{fromEmail}&gt;</span>
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
        <RecipientField label="To" value={to} onChange={setTo} contacts={contacts} autoFocus={!defaultTo.length} />
        <RecipientField label="Cc" value={cc} onChange={setCc} contacts={contacts} />
        {showBcc && (
          <RecipientField label="Bcc" value={bcc} onChange={setBcc} contacts={contacts} autoFocus />
        )}
        <div className="flex min-h-10 items-center gap-2 border-b border-[var(--border)] px-3 text-sm">
          <span className="w-8 shrink-0 text-xs text-[var(--muted-foreground)]">Subj</span>
          <span className="shrink-0 font-mono text-xs text-[var(--muted-foreground)]">[{TICKET_TAG}: #…]</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            autoFocus={defaultTo.length > 0}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
        </div>
        <RichEditor
          placeholder="Write your message… (type / for templates)"
          templates={templates}
          variables={() => {
            const email = to[0] ?? "";
            return recipientVars(
              { email, name: contacts.find((c) => c.email === email)?.name },
              { subject, agent_name: fromName, agent_first_name: firstNameOf(fromName) },
            );
          }}
          onChange={setBody}
          onSubmit={send}
          onEscape={() => {}}
          autoFocusKey={0}
          resetKey={0}
          className="[&_.rich-editor]:min-h-56"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!ready || pending}>
          <Send />
          {pending ? "Sending…" : "Send & create ticket"}
          {!pending && <span className="ml-1 hidden text-[11px] opacity-70 sm:inline">⌘↵</span>}
        </Button>
        <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <input
            type="checkbox"
            checked={assignToMe}
            onChange={(e) => setAssignToMe(e.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Assign to me
        </label>
        {error && <span className="text-xs text-[var(--destructive)]">{error}</span>}
      </div>
      <p className="mt-3 text-xs text-[var(--muted-foreground)]">
        Creates a ticket for the first To address and sends as{" "}
        <span className="font-medium text-[var(--foreground)]">{fromName}</span> from {fromEmail}.
        Replies land on the same ticket.
      </p>
    </form>
  );
}
