import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";
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
  listTemplates,
  requesterHistory,
  ticketAssigneeIds,
  ticketTagIds,
} from "@/lib/queries";
import { taggedSubject } from "@/lib/ticket-subject";
import { photosFor } from "@/lib/people";
import { env } from "@/lib/env";
import { Thread } from "@/components/thread";
import { RequesterHistory } from "@/components/requester-history";
import { RequesterCard } from "@/components/requester-card";
import { TicketMenu } from "@/components/ticket-menu";
import { Composer } from "@/components/composer";
import {
  MobileDetails,
  PresenceBar,
  StarButton,
  TicketHotkeys,
  TicketProperties,
  TicketProvider,
} from "@/components/ticket-workspace";
import { Avatar } from "@/components/ui/avatar";
import { AgeBadge } from "@/components/ui/age-badge";
import { SlaPill } from "@/components/ui/sla-pill";
import { replyDueAt } from "@/lib/sla";
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
  if (ticket.mergedIntoId) {
    const [target] = await db
      .select({ number: tickets.number })
      .from(tickets)
      .where(eq(tickets.id, ticket.mergedIntoId))
      .limit(1);
    if (target) redirect(`/tickets/${target.number}`);
  }

  const [thread, agentList, teamList, tagList, activeTagIds, assigneeIds, nav, history, templateList] =
    await Promise.all([
      getThread(ticket.id),
      listAgents(true),
      listTeams(),
      listTags(),
      ticketTagIds(ticket.id),
      ticketAssigneeIds(ticket.id),
      neighbours(ticket),
      requesterHistory(ticket.requesterEmail, ticket.id),
      listTemplates(),
    ]);

  const photos = await photosFor([
    ticket.requesterEmail,
    ...agentList.map((a) => a.email),
    ...thread.messages.map((m) => m.authorEmail ?? m.fromEmail),
  ]);
  const photo = (email: string) => photos[email.toLowerCase()] ?? null;

  // Reply target: the requester's first unanswered email, if the ticket is open.
  const lastOut = thread.messages.filter((m) => m.direction === "outbound").at(-1)?.sentAt;
  const waiting =
    ticket.status === "open"
      ? thread.messages.find((m) => m.direction === "inbound" && (!lastOut || m.sentAt > lastOut))?.sentAt
      : undefined;
  const dueAt = waiting ? replyDueAt(new Date(waiting), ticket.priority) : null;
  const requesterLabel = ticket.requesterName || ticket.requesterEmail;
  const recipients = replyRecipients(ticket, thread.messages, {
    group: env.groupEmail,
    mailbox: env.gmailMailbox,
  });

  // People on this ticket's emails (not us), for "Change requester".
  const ours = new Set([
    env.groupEmail.toLowerCase(),
    env.gmailMailbox.toLowerCase(),
    ...agentList.map((a) => a.email.toLowerCase()),
  ]);
  const participantMap = new Map<string, { email: string; name: string | null; photo: string | null }>();
  for (const m of thread.messages) {
    if (m.direction === "note") continue;
    for (const e of [m.fromEmail, ...m.toEmails, ...m.ccEmails]) {
      const key = e.toLowerCase();
      if (ours.has(key)) continue;
      const name = key === m.fromEmail.toLowerCase() ? m.fromName : null;
      const prev = participantMap.get(key);
      if (!prev || (!prev.name && name)) participantMap.set(key, { email: key, name, photo: photo(key) });
    }
  }
  const participants = [...participantMap.values()];

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
      <TicketHotkeys newer={nav.newer} older={nav.older} />

      <div className="flex h-[calc(100dvh-3rem)]">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 py-2 sm:px-4 sm:py-2.5">
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
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <PresenceBar />
              <StarButton />
              <TicketMenu ticketId={ticket.id} number={ticket.number} />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <MobileDetails>
              <div>
                <p className="mb-2 text-xs text-[var(--muted-foreground)]">Requester</p>
                <RequesterCard
                  compact
                  ticketId={ticket.id}
                  name={ticket.requesterName}
                  email={ticket.requesterEmail}
                  photo={photo(ticket.requesterEmail)}
                  contacts={participants}
                />
              </div>
              <RequesterHistory email={ticket.requesterEmail} {...history} />
            </MobileDetails>
            <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6 sm:pt-6">
              <h1 className="text-lg font-semibold leading-snug tracking-tight sm:text-xl">
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
                {dueAt && (
                  <>
                    <span aria-hidden>·</span>
                    <SlaPill dueAt={dueAt} />
                  </>
                )}
              </p>
            </div>
            <Thread messages={thread.messages} events={thread.events} photos={photos} />
          </div>

          <Composer
            // Changing the requester changes the default To, so start fresh.
            key={ticket.requesterEmail}
            ticketId={ticket.id}
            subject={taggedSubject(ticket.number, ticket.subject)}
            fromName={agent.name}
            fromEmail={env.groupEmail}
            requesterName={requesterLabel}
            defaultTo={recipients.to}
            defaultCc={recipients.cc}
            contacts={[...contacts.values()]}
            templates={templateList.map((t) => ({ id: t.id, name: t.name, bodyHtml: t.bodyHtml }))}
            ticketNumber={ticket.number}
            ticketSubject={ticket.subject}
            agents={agentList
              .filter((a) => a.id !== agent.id)
              .map((a) => ({ id: a.id, name: a.name, email: a.email }))}
          />
        </div>

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--muted)]/40 md:block">
          <div className="border-b border-[var(--border)] p-4">
            <TicketProperties />
          </div>

          <div className="p-4">
            <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">Requester</p>
            <RequesterCard
              ticketId={ticket.id}
              name={ticket.requesterName}
              email={ticket.requesterEmail}
              photo={photo(ticket.requesterEmail)}
              contacts={participants}
            />

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

          <div className="border-t border-[var(--border)] p-4">
            <RequesterHistory email={ticket.requesterEmail} {...history} />
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
