import { Suspense } from "react";
import Link from "next/link";
import { canManageGmail, requireAgent } from "@/lib/auth";
import { listTags, listTeams, viewCounts } from "@/lib/queries";
import { Sidebar } from "@/components/sidebar";
import { photosFor } from "@/lib/people";
import { Avatar } from "@/components/ui/avatar";
import { GlobalShortcuts } from "@/components/shortcuts";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { agent } = await requireAgent();
  const [counts, teams, tags, photos] = await Promise.all([
    viewCounts(agent),
    listTeams(),
    listTags(),
    photosFor([agent.email]),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4">
        <Link href="/tickets" className="text-sm font-semibold tracking-tight">
          Tickets
        </Link>
        <div className="ml-auto flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <GlobalShortcuts />
          <span className="flex items-center gap-2">
            <span className="hidden sm:inline">{agent.name}</span>
            <Avatar
              name={agent.name}
              email={agent.email}
              photo={photos[agent.email.toLowerCase()]}
              size="sm"
            />
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<div className="w-56 shrink-0 border-r border-[var(--border)]" />}>
          <Sidebar
            counts={counts}
            teams={teams.map((t) => ({ name: t.name, slug: t.slug }))}
            tags={tags.map((t) => ({ name: t.name, slug: t.slug, color: t.color }))}
            isAdmin={agent.role === "admin"}
            canManageGmail={canManageGmail(agent)}
          />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
