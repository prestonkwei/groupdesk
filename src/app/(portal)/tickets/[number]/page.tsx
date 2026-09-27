import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import {
  getThread,
  getTicketByNumber,
  listAgents,
  listTags,
  listTeams,
  neighbours,
  replyRecipients,
  ticketAssigneeIds,
  ticketTagIds,
} from "@/lib/queries";
import { taggedSubject } from "@/lib/ticket-subject";
import { photosFor } from "@/lib/people";
import { env } from "@/lib/env";
import { Thread } from "@/components/thread";
import { Composer } from "@/components/composer";
import {
  StarButton,
  TicketHotkeys,
  TicketProperties,
  TicketProvider,
} from "@/components/ticket-workspace";
import { Avatar } from "@/components/ui/avatar";
import { AgeBadge } from "@/components/ui/age-badge";
import { LiveRefresh } from "@/components/live-refresh";
import { dateTime, relativeTime, shortDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { agent } = await requireAgent();

  const { number } = await params;
  const n = Number(number);
  if (!Number.isInteger(n)) notFound();

  const ticket = await getTicketByNumber(n, agent);
  if (!ticket) notFound();

  const [thread, agentList, teamList, tagList, activeTagIds, assigneeIds, nav] =
    await Promise.all([
      getThread(ticket.id),
      listAgents(true),
      listTeams(),
      listTags(),
      ticketTagIds(ticket.id),
      ticketAssigneeIds(ticket.id),
      neighbours(ticket),
    ]);

  const photos = await photosFor([
    ticket.requesterEmail,
    ...agentList.map((a) => a.email),
    ...thread.messages.map((m) => m.authorEmail ?? m.fromEmail),
  ]);
  const photo = (email: string) => photos[email.toLowerCase()] ?? null;
  const requesterLabel = ticket.requesterName || ticket.requesterEmail;
  const recipients = replyRecipients(ticket, thread.messages, {
    group: env.groupEmail,
    mailbox: env.gmailMailbox,
  });

  // Everyone who has appeared on this ticket, plus the agents, for the
  // To/Cc/Bcc suggestions.
  const contacts = new Map<string, { email: string; name: string | null; photo: string | null }>();
  for (const a of agentList) {
    contacts.set(a.email.toLowerCase(), { email: a.email.toLowerCase(), name: a.name, photo: photo(a.email) });
  }
  for (const m of thread.messages) {
    for (const e of [m.fromEmail, ...m.toEmails, ...m.ccEmails]) {
      const key = e.toLowerCase();
      if (!contacts.has(key)) {
        contacts.set(key, {
          email: key,
          name: key === m.fromEmail.toLowerCase() ? m.fromName : null,
          photo: photo(key),
        });
      }
    }
  }

  return (
    <TicketProvider
      ticketId={ticket.id}
      me={agent.id}
      initial={{
        status: ticket.status,
        priority: ticket.priority,
        assigneeIds,
        teamId: ticket.teamId,
        tagIds: activeTagIds,
        starred: ticket.starred,
      }}
      agents={agentList.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        photo: photo(a.email),
      }))}
      teams={teamList.map((t) => ({ id: t.id, name: t.name }))}
      tags={tagList.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
    >
      <LiveRefresh intervalMs={5000} />
      <TicketHotkeys newer={nav.newer} older={nav.older} />

      <div className="flex h-[calc(100vh-3rem)]">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <Link
              href="/tickets"
              className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label="Back to tickets"
              title="Back to tickets (u)"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="flex items-center">
              <NavArrow href={nav.newer ? `/tickets/${nav.newer}` : null} label="Previous ticket (k)">
                <ChevronUp className="size-4" />
              </NavArrow>
              <NavArrow href={nav.older ? `/tickets/${nav.older}` : null} label="Next ticket (j)">
                <ChevronDown className="size-4" />
              </NavArrow>
            </div>
            <span className="ml-1 text-xs tabular-nums text-[var(--muted-foreground)]">
              #{ticket.number}
            </span>
            <div className="ml-auto">
              <StarButton />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 pt-6">
              <h1 className="text-xl font-semibold leading-snug tracking-tight">
                {ticket.subject}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--muted-foreground)]">
                <Avatar
                  name={ticket.requesterName}
                  email={ticket.requesterEmail}
                  photo={photo(ticket.requesterEmail)}
                  size="xs"
                />
                <span className="font-medium text-[var(--foreground)]">{requesterLabel}</span>
                <span aria-hidden>·</span>
                <span>came in</span>
                <AgeBadge
                  since={ticket.createdAt}
                  resolved={ticket.status === "solved" || ticket.status === "closed"}
                />
                <span aria-hidden>·</span>
                <span>
                  {thread.messages.filter((m) => m.direction !== "note").length} messages
                </span>
              </p>
            </div>
            <Thread messages={thread.messages} events={thread.events} photos={photos} />
          </div>

          <Composer
            ticketId={ticket.id}
            subject={taggedSubject(ticket.number, ticket.subject)}
            fromName={agent.name}
            fromEmail={env.groupEmail}
            requesterName={requesterLabel}
            defaultTo={recipients.to}
            defaultCc={recipients.cc}
            contacts={[...contacts.values()]}
          />
        </div>

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--muted)]/40 md:block">
          <div className="border-b border-[var(--border)] p-4">
            <TicketProperties />
          </div>

          <div className="p-4">
            <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">Requester</p>
            <div className="flex items-center gap-3">
              <Avatar
                name={ticket.requesterName}
                email={ticket.requesterEmail}
                photo={photo(ticket.requesterEmail)}
                size="lg"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{requesterLabel}</p>
                <a
                  href={`mailto:${ticket.requesterEmail}`}
                  className="block truncate text-xs text-[var(--muted-foreground)] hover:underline"
                >
                  {ticket.requesterEmail}
                </a>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-[76px_1fr] gap-x-2 gap-y-2 text-xs">
              <dt className="text-[var(--muted-foreground)]">Opened</dt>
              <dd title={dateTime(ticket.createdAt)}>
                {shortDate(ticket.createdAt)}
              </dd>
              <dt className="text-[var(--muted-foreground)]">Last reply</dt>
              <dd title={dateTime(ticket.lastMessageAt)}>
                {shortDate(ticket.lastMessageAt)} · {relativeTime(ticket.lastMessageAt)}
              </dd>
            </dl>
          </div>
        </aside>
      </div>
    </TicketProvider>
  );
}

function NavArrow({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span className="rounded-md p-1.5 text-[var(--muted-foreground)] opacity-40" aria-hidden>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
    >
      {children}
    </Link>
  );
}
