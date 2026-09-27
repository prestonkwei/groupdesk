import { Suspense } from "react";
import { requireAgent } from "@/lib/auth";
import { listTickets, type TicketFilters, type TicketView } from "@/lib/queries";
import { photosFor } from "@/lib/people";
import { LiveRefresh } from "@/components/live-refresh";
import { SearchBox } from "@/components/search-box";
import { TicketList } from "@/components/ticket-list";

export const dynamic = "force-dynamic";

const VIEW_TITLES: Record<string, string> = {
  unsolved: "Unsolved",
  unassigned: "Unassigned",
  mine: "Assigned to me",
  starred: "Starred",
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
  const photos = await photosFor([
    ...rows.map((r) => r.requesterEmail),
    ...rows.flatMap((r) => r.assignees.map((a) => a.email)),
    agent.email,
  ]);

  const title = filters.team
    ? `Team: ${filters.team}`
    : filters.tag
      ? `Tag: ${filters.tag}`
      : (VIEW_TITLES[filters.view ?? "unsolved"] ?? "Tickets");

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <LiveRefresh />

      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-5">
        <h1 className="text-sm font-semibold">{title}</h1>
        <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
          {rows.length}
          {rows.length === 200 ? "+" : ""}
        </span>
        <div className="ml-auto w-72">
          <Suspense fallback={null}>
            <SearchBox autoFocus={one("focus") === "search"} />
          </Suspense>
        </div>
      </div>

      <TicketList
        rows={rows}
        photos={photos}
        me={{ id: agent.id, name: agent.name, email: agent.email }}
      />
    </div>
  );
}
