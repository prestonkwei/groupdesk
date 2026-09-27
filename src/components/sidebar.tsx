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
  PenSquare,
  FileText,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TagDot } from "@/components/ui/badge";

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
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
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
  className,
}: {
  counts: Counts;
  teams: { name: string; slug: string }[];
  tags: { name: string; slug: string; color: string }[];
  isAdmin: boolean;
  canManageGmail: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const onTickets = pathname === "/tickets";
  const view = params.get("view") ?? "unsolved";
  const team = params.get("team");
  const tag = params.get("tag");

  return (
    <nav className={cn("flex w-56 shrink-0 flex-col gap-6 border-r border-[var(--border)] p-3 text-sm", className)}>
      <Link
        href="/tickets/new"
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 font-medium shadow-sm hover:bg-[var(--accent)]",
          pathname === "/tickets/new" && "bg-[var(--accent)]",
        )}
        title="New message (Shift+C)"
      >
        <PenSquare className="size-4 text-[var(--muted-foreground)]" />
        New message
      </Link>

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

      <Link
        href="/templates"
        className={cn(
          "-mt-4 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
          pathname === "/templates" && "bg-[var(--accent)] font-medium",
        )}
      >
        <FileText className="size-4 text-[var(--muted-foreground)]" />
        Templates
      </Link>

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
          <div className="flex items-center px-2 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Tags
            </p>
            {isAdmin && (
              <Link
                href="/admin/tags"
                className="ml-auto text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
              >
                Edit
              </Link>
            )}
          </div>
          {tags.map((t) => (
            <Link
              key={t.slug}
              href={`/tickets?tag=${t.slug}`}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
                tag === t.slug && "bg-[var(--accent)] font-medium",
              )}
            >
              <TagDot color={t.color} className="ml-1" />
              <span className="truncate">{t.name}</span>
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
