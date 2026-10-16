"use client";

import { usePathname } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bell, CalendarDays, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { setNotifyEmail } from "@/lib/actions/views";
import { disconnectCalendar } from "@/lib/actions/calendar";
import { DATE_DETECTOR } from "@/lib/features";
import { cn } from "@/lib/utils";

/**
 * Avatar menu. Logging out ends this app's session and, where the identity
 * provider supports it, the provider's own session.
 */
export function UserMenu({
  name,
  email,
  photo,
  logoutUrl,
  notifyEmail,
  calendar,
}: {
  notifyEmail: boolean;
  /** The Google account whose calendar is connected, if any. */
  calendar: { email: string; error: string | null } | null;
  name: string;
  email: string;
  photo: string | null;
  /** Null when sign-in isn't configured (local dev). */
  logoutUrl: string | null;
}) {
  const [notify, setNotify] = useOptimistic(notifyEmail);
  const [, start] = useTransition();
  // Come back to the page the agent was on after connecting.
  const connectHref = `/api/calendar/connect?next=${encodeURIComponent(usePathname())}`;
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
          {DATE_DETECTOR && (
            <>
              <div className="my-1 h-px bg-[var(--border)]" />
              <div className="flex items-start gap-2 px-2 py-1.5">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
                <div className="min-w-0 flex-1">
                  <p>Google Calendar</p>
                  {calendar ? (
                    <>
                      <p className="truncate text-[11px] text-[var(--muted-foreground)]" title={calendar.email}>
                        {calendar.email}
                      </p>
                      {calendar.error && (
                        <p className="text-[11px] text-[var(--destructive)]">Last lookup failed; reconnect.</p>
                      )}
                      <div className="mt-1 flex gap-2 text-[11px]">
                        <a href={connectHref} className="text-[var(--primary)] hover:underline">
                          Reconnect
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            start(async () => {
                              await disconnectCalendar();
                            })
                          }
                          className="text-[var(--muted-foreground)] hover:underline"
                        >
                          Disconnect
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      <a href={connectHref} className="text-[var(--primary)] hover:underline">
                        Connect
                      </a>{" "}
                      to see your availability on dates in emails.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="my-1 h-px bg-[var(--border)]" />
          {logoutUrl ? (
            // A full page load, not a client navigation: it may leave for the provider.
            <a
              href={logoutUrl}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]"
            >
              <LogOut className="size-4 text-[var(--muted-foreground)]" />
              Log out
            </a>
          ) : (
            <p className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
              Signed in via DEV_BYPASS_EMAIL — no session to end.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
