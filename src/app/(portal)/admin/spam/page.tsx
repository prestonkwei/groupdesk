import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { agents, blockedSenders } from "@/db/schema";
import { unblockSender } from "@/lib/actions/admin";
import { DeleteForm } from "@/components/admin/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { shortDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SpamPage() {
  await requireAdmin();
  const rows = await db
    .select({ email: blockedSenders.email, createdAt: blockedSenders.createdAt, by: agents.name })
    .from(blockedSenders)
    .leftJoin(agents, eq(agents.id, blockedSenders.blockedBy))
    .orderBy(desc(blockedSenders.createdAt));

  return (
    <div className="max-w-2xl p-6">
      <h1 className="mb-5 text-base font-semibold">Blocked senders</h1>
      <Card>
        <CardHeader>
          <CardTitle>Marked as spam</CardTitle>
          <CardDescription>
            New emails from these addresses still come in, but arrive closed. Mark a ticket as spam from its ⋯ menu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {rows.map((r) => (
              <li key={r.email} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">{r.email}</span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {shortDate(r.createdAt)}
                  {r.by ? ` · ${r.by}` : ""}
                </span>
                <DeleteForm action={unblockSender} id={r.email} label="Unblock" />
              </li>
            ))}
            {rows.length === 0 && (
              <li className="py-6 text-xs text-[var(--muted-foreground)]">Nobody is blocked.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
