import { requireAdmin } from "@/lib/auth";
import { listTeams } from "@/lib/queries";
import { createTeam, deleteTeam } from "@/lib/actions/admin";
import { DeleteForm, NameForm } from "@/components/admin/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  await requireAdmin();
  const teams = await listTeams();

  return (
    <div className="max-w-2xl p-6">
      <h1 className="mb-5 text-base font-semibold">Teams</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>New team</CardTitle>
        </CardHeader>
        <CardContent>
          <NameForm action={createTeam} label="Create team" placeholder="Help Desk" />
        </CardContent>
      </Card>

      <ul className="divide-y divide-[var(--border)] text-sm">
        {teams.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <span className="flex-1">{t.name}</span>
            <span className="text-xs text-[var(--muted-foreground)]">{t.slug}</span>
            <DeleteForm action={deleteTeam} id={t.id} />
          </li>
        ))}
        {teams.length === 0 && (
          <li className="py-6 text-xs text-[var(--muted-foreground)]">No teams yet.</li>
        )}
      </ul>
    </div>
  );
}
