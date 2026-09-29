import { requireAdmin } from "@/lib/auth";
import { peopleStats } from "@/lib/people";
import { rosterConfigured } from "@/lib/roster";
import { recachePeople } from "@/lib/actions/admin";
import { PlainActionButton } from "@/components/admin/forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { env } from "@/lib/env";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
// The recache action inherits this; it stops starting lookups at ~4 minutes.
export const maxDuration = 300;

export default async function PeopleAdminPage() {
  await requireAdmin();
  const stats = await peopleStats();
  const lastFetched = stats.lastFetched ? new Date(stats.lastFetched) : null;

  return (
    <div className="max-w-2xl p-6">
      <h1 className="mb-1 text-base font-semibold">People</h1>
      <p className="mb-5 text-xs text-[var(--muted-foreground)]">
        Photos and names come from Roster ({env.rosterApiUrl || "not configured"}), with the
        Google directory as a fallback. Each person is cached for a week and refreshed in
        the background.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Cache</CardTitle>
          <CardDescription>
            {stats.cached} people cached, {stats.withPhoto} with a photo.
            {lastFetched && ` Last lookup ${relativeTime(lastFetched)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!rosterConfigured() && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ROSTER_API_URL and ROSTER_API_KEY are not both set, so only Google directory
              photos will be used.
            </p>
          )}
          <p className="text-xs text-[var(--muted-foreground)]">
            Re-pulls everyone the portal knows about: agents, requesters, and everyone
            who has sent or been copied on a message. Use it after changing the API key
            or when photos change in Roster.
          </p>
          <PlainActionButton action={recachePeople} label="Recache everyone" variant="default" />
        </CardContent>
      </Card>
    </div>
  );
}
