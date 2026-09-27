"use client";

import { useOptimistic, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bell, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { setNotifyEmail } from "@/lib/actions/views";
import { cn } from "@/lib/utils";

/**
 * Avatar menu. Logging out ends the Cloudflare Access session via Access's
 * own logout URL on this domain; Cloudflare serves it, not the app.
 */
export function UserMenu({
  name,
  email,
  photo,
  logoutUrl,
  notifyEmail,
}: {
  notifyEmail: boolean;
  name: string;
  email: string;
  photo: string | null;
  /** Null when Access isn't in front of the app (local dev). */
  logoutUrl: string | null;
}) {
  const [notify, setNotify] = useOptimistic(notifyEmail);
  const [, start] = useTransition();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full py-0.5 pl-2 pr-0.5 hover:bg-[var(--accent)] data-[state=open]:bg-[var(--accent)]"
          aria-label="Account menu"
        >
          <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline">{name}</span>
          <Avatar name={name} email={email} photo={photo} size="sm" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-60 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-sm shadow-lg"
        >
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar name={name} email={email} photo={photo} size="md" />
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{email}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-[var(--border)]" />
          <button
            type="button"
            role="switch"
            aria-checked={notify}
            onClick={() =>
              start(async () => {
                setNotify(!notify);
                await setNotifyEmail(!notify);
              })
            }
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--accent)]"
          >
            <Bell className="size-4 text-[var(--muted-foreground)]" />
            <span className="flex-1">
              Email notifications
              <span className="block text-[11px] text-[var(--muted-foreground)]">
                Assigned, replies, @mentions
              </span>
            </span>
            <span
              className={cn(
                "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                notify ? "bg-[var(--primary)]" : "bg-[var(--input)]",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-3 rounded-full bg-white transition-all",
                  notify ? "left-3.5" : "left-0.5",
                )}
              />
            </span>
          </button>
          <div className="my-1 h-px bg-[var(--border)]" />
          {logoutUrl ? (
            // A full page load, not a client navigation: Cloudflare handles it.
            <a
              href={logoutUrl}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]"
            >
              <LogOut className="size-4 text-[var(--muted-foreground)]" />
              Log out
            </a>
          ) : (
            <p className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
              Signed in via DEV_BYPASS_EMAIL — no Access session to end.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
