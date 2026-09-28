"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard, X } from "lucide-react";
import { useHotkeys } from "@/lib/hotkeys";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      ["?", "Show this list"],
      ["/", "Search tickets"],
      ["⇧ c", "New message"],
      ["g then u", "Go to Unsolved"],
      ["g then m", "Go to Assigned to me"],
      ["g then n", "Go to Unassigned"],
      ["g then s", "Go to Starred"],
      ["g then a", "Go to All tickets"],
    ],
  },
  {
    title: "Ticket list",
    keys: [
      ["j / k", "Move down / up"],
      ["Enter or o", "Open ticket"],
      ["s", "Star / unstar"],
      ["i", "Assign to me"],
      ["x", "Select ticket"],
      ["⇧ x", "Select range"],
      ["a p c t m", "With a selection: assign, priority, status, tags, team"],
      ["Esc", "Clear selection"],
    ],
  },
  {
    title: "Ticket",
    keys: [
      ["r", "Reply"],
      ["n", "Internal note"],
      ["⌘ Enter", "Send"],
      ["s", "Star / unstar"],
      ["a", "Assign…"],
      ["i", "Assign to me"],
      ["p", "Set priority…"],
      ["c", "Change status…"],
      ["e", "Mark solved"],
      ["t", "Tags…"],
      ["m", "Move to team…"],
      ["j / k", "Next / previous ticket"],
      ["u or Esc", "Back to list"],
    ],
  },
];

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--border)] bg-[var(--muted)] px-1 font-sans text-[11px] font-medium text-[var(--muted-foreground)]">
      {children}
    </kbd>
  );
}

/** Global navigation shortcuts plus the `?` cheat sheet. Mounted once in the portal layout. */
export function GlobalShortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useHotkeys({
    "?": () => setOpen((o) => !o),
    "/": () => {
      const el = document.getElementById("ticket-search") as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      } else router.push("/tickets?focus=search");
    },
    C: () => router.push("/tickets/new"),
    "g u": () => router.push("/tickets?view=unsolved"),
    "g m": () => router.push("/tickets?view=mine"),
    "g n": () => router.push("/tickets?view=unassigned"),
    "g s": () => router.push("/tickets?view=starred"),
    "g a": () => router.push("/tickets?view=all"),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        title="Keyboard shortcuts (?)"
      >
        <Keyboard className="size-3.5" />
        <span className="hidden sm:inline">Shortcuts</span>
      </button>

      {open && (
        <div
          data-hotkeys-dialog
          ref={(el) => el?.focus()}
          tabIndex={-1}
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 outline-none"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "?") setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-label="Keyboard shortcuts"
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center">
              <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <section key={g.title} className={g.title === "Ticket" ? "sm:row-span-2" : ""}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    {g.title}
                  </h3>
                  <ul className="space-y-1.5">
                    {g.keys.map(([k, label]) => (
                      <li key={k} className="flex items-center justify-between gap-4 text-sm">
                        <span>{label}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {k.split(" ").map((part, i, parts) =>
                            parts.length > 1 && (part === "then" || part === "or" || part === "/") ? (
                              <span key={i} className="text-xs text-[var(--muted-foreground)]">
                                {part}
                              </span>
                            ) : (
                              <Kbd key={i}>{part}</Kbd>
                            ),
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
