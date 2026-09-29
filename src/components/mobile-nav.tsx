"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { APP_NAME } from "@/lib/utils";

/**
 * Below the md breakpoint the sidebar becomes a slide-out drawer behind a
 * menu button. Following any link in it closes it again.
 */
export function MobileNav(props: React.ComponentProps<typeof Sidebar>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-ml-1.5 rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] md:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Menu">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-[var(--background)] shadow-xl"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            <div className="flex h-12 shrink-0 items-center border-b border-[var(--border)] px-4">
              <span className="text-sm font-semibold">{APP_NAME}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <Sidebar {...props} className="w-full flex-1 border-r-0" />
          </div>
        </div>
      )}
    </>
  );
}
