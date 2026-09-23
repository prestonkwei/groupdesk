import { requireAdmin } from "@/lib/auth";
import { agentTeamRows, listAgents, listTeams } from "@/lib/queries";
import { setAgentActive, setAgentTeam, upsertAgent } from "@/lib/actions/admin";
import {
  AddAgentForm,
  AgentTeamToggles,
  ToggleAgentForm,
} from "@/components/admin/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  await requireAdmin();
  const [agents, teams, memberships] = await Promise.all([
    listAgents(),
    listTeams(),
    agentTeamRows(),
  ]);

  const teamsByAgent = new Map<string, string[]>();
  for (const m of memberships) {
    teamsByAgent.set(m.agentId, [...(teamsByAgent.get(m.agentId) ?? []), m.teamId]);
  }

  return (
    <div className="max-w-4xl p-6">
      <h1 className="mb-1 text-base font-semibold">Agents</h1>
      <p className="mb-5 text-xs text-[var(--muted-foreground)]">
        Adding someone here lets them use the portal. They also need to be in the
        Cloudflare Access policy for the portal domain — that is a separate list.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add an agent</CardTitle>
          <CardDescription>
            The email must match the one they sign in to Cloudflare Access with.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddAgentForm action={upsertAgent} />
        </CardContent>
      </Card>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
          <tr className="border-b border-[var(--border)]">
            <th className="py-2 font-semibold">Name</th>
            <th className="py-2 font-semibold">Email</th>
            <th className="py-2 font-semibold">Role</th>
            <th className="py-2 font-semibold">Teams</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr
              key={a.id}
              className={`border-b border-[var(--border)] ${a.active ? "" : "opacity-50"}`}
            >
              <td className="py-2 pr-3">{a.name}</td>
              <td className="py-2 pr-3 text-[var(--muted-foreground)]">{a.email}</td>
              <td className="py-2 pr-3 capitalize">{a.role}</td>
              <td className="py-2 pr-3">
                <AgentTeamToggles
                  action={setAgentTeam}
                  agentId={a.id}
                  teams={teams.map((t) => ({ id: t.id, name: t.name }))}
                  memberOf={teamsByAgent.get(a.id) ?? []}
                />
              </td>
              <td className="py-2 text-right">
                <ToggleAgentForm action={setAgentActive} id={a.id} active={a.active} />
              </td>
            </tr>
          ))}
          {agents.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-xs text-[var(--muted-foreground)]">
                No agents yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
