import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import {
  getThread,
  getTicketByNumber,
  listAgents,
  listTags,
  listTeams,
  ticketTagIds,
} from "@/lib/queries";
import { env } from "@/lib/env";
import { Thread } from "@/components/thread";
import { Composer } from "@/components/composer";
import { TicketControls } from "@/components/ticket-controls";
import { StatusBadge } from "@/components/ui/badge";
import { LiveRefresh } from "@/components/live-refresh";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  await requireAgent();

  const { number } = await params;
  const n = Number(number);
  if (!Number.isInteger(n)) notFound();

  const ticket = await getTicketByNumber(n);
  if (!ticket) notFound();

  const [thread, agentList, teamList, tagList, activeTagIds] = await Promise.all([
    getThread(ticket.id),
    listAgents(true),
    listTeams(),
    listTags(),
    ticketTagIds(ticket.id),
  ]);

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <LiveRefresh intervalMs={5000} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-3">
          <Link
            href="/tickets"
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Back to tickets"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{ticket.subject}</h1>
            <p className="text-xs text-[var(--muted-foreground)]">
              #{ticket.number} · {ticket.requesterName || ticket.requesterEmail}
            </p>
          </div>
          <div className="ml-auto">
            <StatusBadge status={ticket.status} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Thread messages={thread.messages} events={thread.events} />
        </div>

        <Composer
          ticketId={ticket.id}
          requesterEmail={ticket.requesterEmail}
          groupEmail={env.groupEmail}
        />
      </div>

      <aside className="w-64 shrink-0 overflow-y-auto border-l border-[var(--border)] p-4">
        <div className="mb-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Requester
          </p>
          <p className="text-sm">{ticket.requesterName || "—"}</p>
          <a
            href={`mailto:${ticket.requesterEmail}`}
            className="break-all text-xs text-[var(--muted-foreground)] hover:underline"
          >
            {ticket.requesterEmail}
          </a>
        </div>

        <TicketControls
          ticketId={ticket.id}
          status={ticket.status}
          assigneeId={ticket.assigneeId}
          teamId={ticket.teamId}
          agents={agentList.map((a) => ({ id: a.id, name: a.name }))}
          teams={teamList.map((t) => ({ id: t.id, name: t.name }))}
          tags={tagList.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
          activeTagIds={activeTagIds}
        />

        <dl className="mt-6 space-y-2 text-xs text-[var(--muted-foreground)]">
          <div>
            <dt className="font-semibold uppercase tracking-wide">Opened</dt>
            <dd>{new Date(ticket.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide">Last message</dt>
            <dd>{new Date(ticket.lastMessageAt).toLocaleString()}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
