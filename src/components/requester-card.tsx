"use client";

import { useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Pencil } from "lucide-react";
import { setRequester } from "@/lib/actions/tickets";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Contact } from "@/components/recipient-field";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * The requester, with a "Change" popover: pick someone from the thread or type
 * any address. For forwards and emails sent on someone's behalf.
 */
export function RequesterCard({
  ticketId,
  name,
  email,
  photo,
  contacts,
  compact = false,
}: {
  ticketId: string;
  name: string | null;
  email: string;
  photo: string | null;
  /** People on this ticket's emails, suggested first. */
  contacts: Contact[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const q = query.trim().toLowerCase();
  const suggestions = contacts
    .filter((c) => c.email !== email.toLowerCase())
    .filter((c) => !q || c.email.includes(q) || c.name?.toLowerCase().includes(q))
    .slice(0, 6);

  function choose(target: { email: string; name?: string | null }) {
    setError(null);
    start(async () => {
      const r = await setRequester(ticketId, target);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        setQuery("");
        setNewName("");
      }
    });
  }

  return (
    <div className={cn("flex items-center gap-3", compact && "gap-2")}>
      <Avatar name={name} email={email} photo={photo} size={compact ? "sm" : "lg"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name || email}</p>
        <a
          href={`mailto:${email}`}
          className="block truncate text-xs text-[var(--muted-foreground)] hover:underline"
        >
          {email}
        </a>
      </div>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] data-[state=open]:bg-[var(--accent)]"
            title="Change requester"
            aria-label="Change requester"
          >
            <Pencil className="size-3.5" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm shadow-lg"
          >
            <p className="mb-2 text-xs font-medium">Change requester</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (suggestions.length === 1 && !EMAIL_RE.test(q)) choose(suggestions[0]);
                else choose({ email: q, name: newName || null });
              }}
              className="space-y-2"
            >
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or email"
                className="h-8 text-sm"
              />
              {EMAIL_RE.test(q) && !contacts.some((c) => c.email === q) && (
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Their name (optional)"
                  className="h-8 text-sm"
                />
              )}
              {suggestions.length > 0 && (
                <ul className="-mx-1 max-h-48 overflow-y-auto">
                  {suggestions.map((c) => (
                    <li key={c.email}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => choose(c)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--accent)]"
                      >
                        <Avatar name={c.name} email={c.email} photo={c.photo} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate">{c.name ?? c.email}</span>
                          {c.name && (
                            <span className="block truncate text-xs text-[var(--muted-foreground)]">{c.email}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {EMAIL_RE.test(q) && (
                <Button type="submit" size="sm" disabled={pending} className="w-full">
                  {pending ? "Saving…" : `Use ${q}`}
                </Button>
              )}
              {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Replies go to the requester by default.
              </p>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
