import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { buildReport, RANGES, type Breakdown, type ReportRange } from "@/lib/reports";
import { VolumeChart } from "@/components/volume-chart";
import { ConfirmActionButton, PlainActionButton } from "@/components/admin/forms";
import { previewDigest, sendDigestToEveryone } from "@/lib/actions/admin";
import { TagDot } from "@/components/ui/badge";
import { cn, shortDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function duration(sec: number | null) {
  if (sec === null) return "—";
  const min = sec / 60;
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const hr = min / 60;
  if (hr < 48) return `${Math.floor(hr)}h ${Math.round(min % 60)}m`;
  return `${(hr / 24).toFixed(1)}d`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; imported?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const range = (RANGES.some((r) => r.value === sp.range) ? sp.range : "30d") as ReportRange;
  const includeImported = sp.imported === "1";
  const report = await buildReport(range, includeImported);
  const o = report.overall;

  const href = (next: { range?: string; imported?: boolean }) => {
    const p = new URLSearchParams({ range: next.range ?? range });
    if (next.imported ?? includeImported) p.set("imported", "1");
    return `/admin/reports?${p}`;
  };

  return (
    <div className="h-[calc(100dvh-3rem)] overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold">Reports</h1>
          <nav className="ml-auto flex rounded-lg border border-[var(--border)] p-0.5 text-xs" aria-label="Date range">
            {RANGES.map((r) => (
              <Link
                key={r.value}
                href={href({ range: r.value })}
                className={cn(
                  "rounded-md px-2.5 py-1",
                  r.value === range
                    ? "bg-[var(--accent)] font-medium text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                {r.label}
              </Link>
            ))}
          </nav>
          <Link
            href={href({ imported: !includeImported })}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            role="switch"
            aria-checked={includeImported}
          >
            <span
              className={cn(
                "grid size-3.5 place-items-center rounded border",
                includeImported ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--input)]",
              )}
            >
              {includeImported && <span className="size-1.5 rounded-sm bg-[var(--primary-foreground)]" />}
            </span>
            Include imported
          </Link>
        </div>

        <p className="-mt-3 text-xs text-[var(--muted-foreground)]">
          Tickets that came in {range === "all" ? "at any time" : `since ${shortDate(report.from)}`}.{" "}
          {includeImported
            ? "Includes backfilled tickets, whose timings predate the portal."
            : report.importedCount > 0
              ? `${report.importedCount.toLocaleString()} backfilled ticket${report.importedCount === 1 ? "" : "s"} left out, since their timings predate the portal.`
              : ""}
        </p>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="Came in" value={o.tickets.toLocaleString()} />
          <Tile label="Resolved" value={o.resolved.toLocaleString()} sub={o.tickets ? `${Math.round((o.resolved / o.tickets) * 100)}%` : undefined} />
          <Tile label="Still open" value={o.open.toLocaleString()} />
          <Tile label="Median first response" value={duration(o.medianFirstResponse)} sub={`${o.responded} answered`} />
          <Tile label="Median time to resolve" value={duration(o.medianResolve)} />
        </dl>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-3 text-sm font-semibold">
            Tickets in vs resolved, per {report.weekly ? "week" : "day"}
          </h2>
          <VolumeChart data={report.volume} weekly={report.weekly} />
        </section>

        <BreakdownTable title="By team" rows={report.byTeam} />
        <BreakdownTable title="By tag" rows={report.byTag} tags />
        <BreakdownTable title="By agent" rows={report.byAgent} note="Tickets assigned to them; a ticket with two assignees counts for both." />

        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Weekly digest</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Every Friday at 4pm Pacific, each agent gets their open and pending counts, what they solved that
              week, their longest-open ticket and links to the rest.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PlainActionButton action={previewDigest} label="Email me a test" />
            <ConfirmActionButton
              action={sendDigestToEveryone}
              label="Send to everyone now"
              confirm="Email every active agent their digest right now? Friday's regular digest still goes out."
            />
          </div>
        </section>

        <p className="pb-4 text-xs text-[var(--muted-foreground)]">
          First response: the first email from the requester to the first reply from the team (portal or Gmail).
          Time to resolve: when the email came in to the first time it was marked solved. Both are medians, in
          calendar time (not business hours). Closed tickets (notifications and other non-requests) aren&apos;t counted.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {sub && <dd className="text-xs text-[var(--muted-foreground)]">{sub}</dd>}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  tags = false,
  note,
}: {
  title: string;
  rows: Breakdown[];
  tags?: boolean;
  note?: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="px-4 pt-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{note}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--muted-foreground)]">Nothing in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[560px] text-sm">
            <thead className="text-xs text-[var(--muted-foreground)]">
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-right font-medium">Tickets</th>
                <th className="px-4 py-2 text-right font-medium">Resolved</th>
                <th className="px-4 py-2 text-right font-medium">Open</th>
                <th className="px-4 py-2 text-right font-medium">Median first response</th>
                <th className="px-4 py-2 text-right font-medium">Median to resolve</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      {tags && r.color && <TagDot color={r.color} />}
                      <span className={cn(r.key === "none" && "text-[var(--muted-foreground)]")}>{r.label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.tickets}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.resolved}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.open}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{duration(r.medianFirstResponse)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{duration(r.medianResolve)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
