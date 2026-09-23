import Link from "next/link";
import { Suspense } from "react";
import { requireAgent } from "@/lib/auth";
import { listTickets, type TicketFilters, type TicketView } from "@/lib/queries";
import { StatusBadge, TagBadge } from "@/components/ui/badge";
import { LiveRefresh } from "@/components/live-refresh";
import { relativeTime } from "@/lib/utils";
import { SearchBox } from "@/components/search-box";

export const dynamic = "force-dynamic";

const VIEW_TITLES: Record<string, string> = {
  unsolved: "Unsolved tickets",
  unassigned: "Unassigned tickets",
  mine: "Assigned to me",
  all: "All tickets",
};

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agent } = await requireAgent();
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const filters: TicketFilters = {
    view: (one("view") as TicketView) ?? (one("team") || one("tag") ? "all" : "unsolved"),
    team: one("team"),
    tag: one("tag"),
    status: one("status"),
    q: one("q"),
  };

  const rows = await listTickets(filters, agent);

  const title = filters.team
    ? `Team: ${filters.team}`
    : filters.tag
      ? `Tag: ${filters.tag}`
      : (VIEW_TITLES[filters.view ?? "unsolved"] ?? "Tickets");

  return (
    <div className="flex h-full flex-col">
      <LiveRefresh />

      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3">
        <h1 className="text-sm font-semibold">{title}</h1>
        <span className="text-xs text-[var(--muted-foreground)]">
          {rows.length}
          {rows.length === 200 ? "+" : ""}
        </span>
        <div className="ml-auto w-64">
          <Suspense fallback={null}>
            <SearchBox />
          </Suspense>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="p-8 text-sm text-[var(--muted-foreground)]">
          Nothing here. New mail to the group shows up within a few seconds.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tickets/${t.number}`}
                className="flex items-start gap-3 px-5 py-3 hover:bg-[var(--accent)]"
              >
                <span
                  className={`status-${t.status} mt-1.5 size-2 shrink-0 rounded-full [background-color:var(--status)]`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{t.subject}</span>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                      #{t.number}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <span className="truncate">
                      {t.requesterName || t.requesterEmail}
                    </span>
                    <span>·</span>
                    <span>{t.messageCount} message{t.messageCount === 1 ? "" : "s"}</span>
                    {t.teamName && (
                      <>
                        <span>·</span>
                        <span>{t.teamName}</span>
                      </>
                    )}
                    {t.tags.map((tag) => (
                      <TagBadge key={tag.slug} name={tag.name} color={tag.color} />
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={t.status} />
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {relativeTime(t.lastMessageAt)}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {t.assigneeName ?? "Unassigned"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
