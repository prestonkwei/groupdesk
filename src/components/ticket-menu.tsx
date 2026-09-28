"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { ArrowLeft, Ban, Merge, MoreHorizontal } from "lucide-react";
import { findMergeTargets, markSpam, mergeTicket } from "@/lib/actions/tickets";
import { StatusIcon } from "@/components/ui/ticket-icons";
import { Input } from "@/components/ui/input";

type Target = { number: number; subject: string; status: string; requester: string };

/** "⋯" on a ticket: merge it into another ticket, or close it as spam. */
export function TicketMenu({ ticketId, number }: { ticketId: string; number: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "merge">("menu");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Target[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (mode !== "merge") return;
    const t = setTimeout(async () => setResults(await findMergeTargets(query, ticketId)), 200);
    return () => clearTimeout(t);
  }, [query, mode, ticketId]);

  function merge(target: Target) {
    if (!window.confirm(`Merge #${number} into #${target.number} “${target.subject}”? Its emails, notes, tags and assignees move over and #${number} is closed.`)) return;
    start(async () => {
      const r = await mergeTicket(ticketId, target.number);
      if (r.error || !r.number) setError(r.error ?? "Merge failed");
      else {
        setOpen(false);
        router.push(`/tickets/${r.number}`);
      }
    });
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setMode("menu");
          setQuery("");
          setError(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] data-[state=open]:bg-[var(--accent)]"
          aria-label="More actions"
          title="More actions"
        >
          <MoreHorizontal className="size-[18px]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-80 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-sm shadow-lg"
        >
          {mode === "menu" ? (
            <>
              <button
                type="button"
                onClick={() => setMode("merge")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--accent)]"
              >
                <Merge className="size-4 text-[var(--muted-foreground)]" /> Merge into another ticket…
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Close this ticket as spam and block the sender? Their future emails will arrive already closed.")) return;
                  start(async () => {
                    const r = await markSpam(ticketId);
                    if (r.error) setError(r.error);
                    else setOpen(false);
                  });
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[var(--destructive)] hover:bg-[var(--accent)]"
              >
                <Ban className="size-4" /> Mark as spam &amp; block sender
              </button>
              {error && <p className="px-2 py-1.5 text-xs text-[var(--destructive)]">{error}</p>}
            </>
          ) : (
            <div className="p-1">
              <div className="mb-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMode("menu")}
                  className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                  aria-label="Back"
                >
                  <ArrowLeft className="size-3.5" />
                </button>
                <span className="text-xs font-medium">Merge #{number} into…</span>
              </div>
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by subject, person or #number"
                className="h-8 text-sm"
              />
              <ul className="mt-1 max-h-64 overflow-y-auto">
                {results.map((t) => (
                  <li key={t.number}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => merge(t)}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--accent)]"
                    >
                      <StatusIcon status={t.status} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block truncate">#{t.number} {t.subject}</span>
                        <span className="block truncate text-xs text-[var(--muted-foreground)]">{t.requester}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {results.length === 0 && (
                  <li className="px-2 py-3 text-xs text-[var(--muted-foreground)]">No matching tickets</li>
                )}
              </ul>
              {error && <p className="px-2 pt-1 text-xs text-[var(--destructive)]">{error}</p>}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
