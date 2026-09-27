import { Suspense } from "react";
import Link from "next/link";
import { canManageGmail, requireAgent } from "@/lib/auth";
import { listTags, listTeams, viewCounts } from "@/lib/queries";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { photosFor } from "@/lib/people";
import { UserMenu } from "@/components/user-menu";
import { env } from "@/lib/env";
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

  const sidebar = {
    counts,
    teams: teams.map((t) => ({ name: t.name, slug: t.slug })),
    tags: tags.map((t) => ({ name: t.name, slug: t.slug, color: t.color })),
    isAdmin: agent.role === "admin",
    canManageGmail: canManageGmail(agent),
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4">
        <Suspense fallback={null}>
          <MobileNav {...sidebar} />
        </Suspense>
        <Link href="/tickets" className="text-sm font-semibold tracking-tight">
          Tickets
        </Link>
        <div className="ml-auto flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <GlobalShortcuts />
          <UserMenu
            name={agent.name}
            email={agent.email}
            photo={photos[agent.email.toLowerCase()] ?? null}
            logoutUrl={env.cfTeamDomain && env.cfAud ? "/cdn-cgi/access/logout" : null}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<div className="hidden w-56 shrink-0 border-r border-[var(--border)] md:block" />}>
          <Sidebar {...sidebar} className="hidden md:flex" />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
