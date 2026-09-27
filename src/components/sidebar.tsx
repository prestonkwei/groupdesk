"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Inbox,
  InboxIcon,
  User,
  CircleDot,
  Users,
  Tags,
  Mail,
  UserCog,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Counts = {
  all: number;
  unsolved: number;
  unassigned: number;
  mine: number;
  starred: number;
};

const VIEWS = [
  { key: "unsolved", label: "Unsolved", icon: CircleDot },
  { key: "unassigned", label: "Unassigned", icon: Inbox },
  { key: "mine", label: "Assigned to me", icon: User },
  { key: "starred", label: "Starred", icon: Star },
  { key: "all", label: "All tickets", icon: InboxIcon },
] as const;

const ADMIN = [
  { href: "/admin/agents", label: "Agents", icon: UserCog },
  { href: "/admin/teams", label: "Teams", icon: Users },
  { href: "/admin/tags", label: "Tags", icon: Tags },
  { href: "/admin/gmail", label: "Gmail", icon: Mail },
] as const;

export function Sidebar({
  counts,
  teams,
  tags,
  isAdmin,
  canManageGmail,
}: {
  counts: Counts;
  teams: { name: string; slug: string }[];
  tags: { name: string; slug: string }[];
  isAdmin: boolean;
  canManageGmail: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const onTickets = pathname === "/tickets";
  const view = params.get("view") ?? "unsolved";
  const team = params.get("team");
  const tag = params.get("tag");

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-6 border-r border-[var(--border)] p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Views
        </p>
        {VIEWS.map((v) => {
          const active = onTickets && !team && !tag && view === v.key;
          const Icon = v.icon;
          return (
            <Link
              key={v.key}
              href={`/tickets?view=${v.key}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
                active && "bg-[var(--accent)] font-medium",
              )}
            >
              <Icon className="size-4 text-[var(--muted-foreground)]" />
              <span className="flex-1 truncate">{v.label}</span>
              <span className="tabular-nums text-xs text-[var(--muted-foreground)]">
                {counts[v.key as keyof Counts]}
              </span>
            </Link>
          );
        })}
      </div>

      {teams.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Teams
          </p>
          {teams.map((t) => (
            <Link
              key={t.slug}
              href={`/tickets?team=${t.slug}`}
              className={cn(
                "truncate rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
                team === t.slug && "bg-[var(--accent)] font-medium",
              )}
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Tags
          </p>
          {tags.map((t) => (
            <Link
              key={t.slug}
              href={`/tickets?tag=${t.slug}`}
              className={cn(
                "truncate rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
                tag === t.slug && "bg-[var(--accent)] font-medium",
              )}
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="mt-auto flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Admin
          </p>
          {ADMIN.filter((a) => a.href !== "/admin/gmail" || canManageGmail).map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
                  pathname === a.href && "bg-[var(--accent)] font-medium",
                )}
              >
                <Icon className="size-4 text-[var(--muted-foreground)]" />
                {a.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
