"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Searches as you type (after a short pause). Matching is fuzzy on the
 * server: typos in a subject or name still hit, and "#1058" finds a ticket.
 */
export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      next.delete("focus");
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      if (next.toString() === params.toString()) return;
      startTransition(() => router.replace(`/tickets?${next}`));
    }, 250);
    return () => clearTimeout(t);
    // Only the typed value should retrigger a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <form onSubmit={(e) => e.preventDefault()} className="relative">
      {pending ? (
        <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-[var(--muted-foreground)]" />
      ) : (
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
      )}
      <Input
        id="ticket-search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) setValue("");
            else e.currentTarget.blur();
          }
        }}
        placeholder="Search tickets, people, #number…"
        className="h-8 pl-8 pr-8 text-sm"
        autoComplete="off"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border sm:block border-[var(--border)] px-1 text-[10px] text-[var(--muted-foreground)]">
          /
        </kbd>
      )}
    </form>
  );
}
