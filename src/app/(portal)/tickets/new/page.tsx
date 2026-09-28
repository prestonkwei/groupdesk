import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { listAgents, listTemplates, recentRequesters } from "@/lib/queries";
import { photosFor } from "@/lib/people";
import { env } from "@/lib/env";
import { NewMessageForm } from "@/components/new-message";

export const dynamic = "force-dynamic";

export default async function NewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const { agent } = await requireAgent();
  const { to } = await searchParams;
  const [agentList, requesters, templateList] = await Promise.all([
    listAgents(true),
    recentRequesters(),
    listTemplates(),
  ]);

  const contacts = new Map<string, { email: string; name: string | null }>();
  for (const a of agentList) contacts.set(a.email.toLowerCase(), { email: a.email.toLowerCase(), name: a.name });
  for (const r of requesters) {
    const key = r.email.toLowerCase();
    if (!contacts.has(key)) contacts.set(key, { email: key, name: r.name });
  }
  const photos = await photosFor([...contacts.keys()].slice(0, 60));

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 sm:px-4">
        <Link
          href="/tickets"
          className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          aria-label="Back to tickets"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold">New message</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NewMessageForm
          fromName={agent.name}
          fromEmail={env.groupEmail}
          defaultTo={to && to.includes("@") ? [to.toLowerCase()] : []}
          defaultCc={[]}
          contacts={[...contacts.values()].map((c) => ({ ...c, photo: photos[c.email] ?? null }))}
          templates={templateList.map((t) => ({ id: t.id, name: t.name, bodyHtml: t.bodyHtml }))}
        />
      </div>
    </div>
  );
}
