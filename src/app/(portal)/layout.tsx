import { Suspense } from "react";
import Link from "next/link";
import { canManageGmail, requireAgent } from "@/lib/auth";
import { listTags, listTeams, viewCounts } from "@/lib/queries";
import { Sidebar } from "@/components/sidebar";
import { initials } from "@/lib/utils";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { agent } = await requireAgent();
  const [counts, teams, tags] = await Promise.all([
    viewCounts(agent),
    listTeams(),
    listTags(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4">
        <Link href="/tickets" className="text-sm font-semibold tracking-tight">
          Tickets
        </Link>
        <div className="ml-auto flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <span>{agent.name}</span>
          <span className="grid size-6 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-semibold text-[var(--accent-foreground)]">
            {initials(agent.name)}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<div className="w-56 shrink-0 border-r border-[var(--border)]" />}>
          <Sidebar
            counts={counts}
            teams={teams.map((t) => ({ name: t.name, slug: t.slug }))}
            tags={tags.map((t) => ({ name: t.name, slug: t.slug }))}
            isAdmin={agent.role === "admin"}
            canManageGmail={canManageGmail(agent)}
          />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
