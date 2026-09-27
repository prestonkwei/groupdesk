"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type Contact = { email: string; name: string | null; photo: string | null };

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Pulls addresses out of anything pasted: "A <a@x.org>, b@y.org; c@z.org". */
function extract(text: string): string[] {
  return (text.match(/[^\s,;<>"]+@[^\s,;<>"]+\.[^\s,;<>"]+/g) ?? []).map((e) =>
    e.toLowerCase(),
  );
}

/**
 * Email chips: type an address and press Enter, comma or Tab; paste a list;
 * Backspace on an empty input removes the last chip. Suggests known contacts.
 */
export function RecipientField({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  contacts: Contact[];
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const byEmail = new Map(contacts.map((c) => [c.email.toLowerCase(), c]));

  const q = input.trim().toLowerCase();
  const suggestions = q
    ? contacts
        .filter(
          (c) =>
            !value.includes(c.email.toLowerCase()) &&
            (c.email.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q)),
        )
        .slice(0, 6)
    : [];

  function add(emails: string[]) {
    const next = [...value];
    for (const e of emails) if (EMAIL_RE.test(e) && !next.includes(e)) next.push(e);
    onChange(next);
    setInput("");
    setActive(0);
  }

  function commit() {
    if (suggestions[active] && !EMAIL_RE.test(q)) add([suggestions[active].email.toLowerCase()]);
    else if (q) add(extract(q).length ? extract(q) : [q]);
  }

  const invalid = q.length > 0 && !suggestions.length && !EMAIL_RE.test(q) && q.includes("@") && q.includes(".");

  return (
    <div className="relative flex min-h-9 items-start gap-2 border-b border-[var(--border)] px-3 py-1.5 text-sm">
      <span className="w-8 shrink-0 pt-1 text-xs text-[var(--muted-foreground)]">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((email) => {
          const c = byEmail.get(email);
          return (
            <span
              key={email}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--muted)] py-0.5 pl-0.5 pr-1.5 text-xs"
              title={email}
            >
              <Avatar name={c?.name} email={email} photo={c?.photo} size="xs" />
              <span className="truncate">{c?.name ?? email}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== email))}
                className="rounded-full p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                aria-label={`Remove ${email}`}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <input
          value={input}
          autoFocus={autoFocus}
          onChange={(e) => {
            setInput(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (EMAIL_RE.test(q)) add([q]);
          }}
          onPaste={(e) => {
            const found = extract(e.clipboardData.getData("text"));
            if (found.length > 1) {
              e.preventDefault();
              add(found);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && q)) {
              if (q) {
                e.preventDefault();
                commit();
              }
            } else if (e.key === "Backspace" && !input && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "ArrowDown" && suggestions.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % suggestions.length);
            } else if (e.key === "ArrowUp" && suggestions.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
            }
          }}
          role="combobox"
          aria-expanded={focused && suggestions.length > 0}
          aria-controls={listId}
          aria-label={`${label} recipients`}
          className={cn(
            "h-6 min-w-32 flex-1 bg-transparent text-sm outline-none",
            invalid && "text-[var(--destructive)]",
          )}
        />
      </div>

      {focused && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-12 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg"
        >
          {suggestions.map((c, i) => (
            <li
              key={c.email}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add([c.email.toLowerCase()]);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                i === active && "bg-[var(--accent)]",
              )}
            >
              <Avatar name={c.name} email={c.email} photo={c.photo} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm">{c.name ?? c.email}</span>
                {c.name && (
                  <span className="block truncate text-xs text-[var(--muted-foreground)]">{c.email}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
