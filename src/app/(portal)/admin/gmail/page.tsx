import Link from "next/link";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getSyncRow } from "@/lib/gmail/client";
import { disconnectGmail, renewWatch, runSyncNow } from "@/lib/actions/admin";
import {
  DisconnectForm,
  PlainActionButton,
} from "@/components/admin/forms";
import { Button } from "@/components/ui/button";
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

const HOURS_48 = 48 * 60 * 60 * 1000;

function fmt(d: Date | null | undefined) {
  return d ? `${new Date(d).toLocaleString()} (${relativeTime(d)})` : "never";
}

/** Reading the clock is impure, so it stays out of the component body. */
async function nowMs() {
  return Date.now();
}

export default async function GmailAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const row = await getSyncRow();

  const now = await nowMs();
  const expiresIn = row?.watchExpiration
    ? new Date(row.watchExpiration).getTime() - now
    : null;

  const health: { tone: "ok" | "warn" | "bad"; text: string } = !row
    ? { tone: "bad", text: "No mailbox connected — nothing is being ingested." }
    : row.lastError
      ? { tone: "bad", text: `Last operation failed: ${row.lastError}` }
      : expiresIn === null
        ? { tone: "warn", text: "Connected, but the watch has never been started." }
        : expiresIn < 0
          ? { tone: "bad", text: "The watch has expired. Renew it now." }
          : expiresIn < HOURS_48
            ? { tone: "warn", text: "The watch expires in under 48 hours." }
            : { tone: "ok", text: "Connected and watching." };

  const Icon =
    health.tone === "ok" ? CheckCircle2 : health.tone === "warn" ? AlertTriangle : XCircle;

  return (
    <div className="max-w-2xl p-6">
      <h1 className="mb-1 text-base font-semibold">Gmail connection</h1>
      <p className="mb-5 text-xs text-[var(--muted-foreground)]">
        Mail reaches this portal through a Gmail watch on the{" "}
        <code className="rounded bg-[var(--muted)] px-1">{env.labelName}</code> label,
        pushed to Pub/Sub. Reconnecting here is a one-click fix — no redeploy.
      </p>

      {sp.ok && (
        <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {sp.ok}
        </p>
      )}
      {sp.error && (
        <p className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {sp.error}
        </p>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon
              className={
                health.tone === "ok"
                  ? "size-4 text-emerald-600"
                  : health.tone === "warn"
                    ? "size-4 text-amber-500"
                    : "size-4 text-rose-600"
              }
            />
            {row ? row.email : "Not connected"}
          </CardTitle>
          <CardDescription>{health.text}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
            <Row label="Watch expires" value={fmt(row?.watchExpiration)} />
            <Row label="Last push received" value={fmt(row?.lastPushAt)} />
            <Row label="Last successful sync" value={fmt(row?.lastSyncAt)} />
            <Row label="History cursor" value={row?.lastHistoryId ?? "—"} />
            <Row label="Label id" value={row?.labelId ?? "not resolved yet"} />
            <Row label="Pub/Sub topic" value={process.env.GMAIL_PUBSUB_TOPIC ?? "—"} />
            <Row label="Push endpoint" value={`${env.appUrl}/api/gmail/push`} />
          </dl>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
            <Button size="sm" asChild>
              <Link href="/api/admin/gmail/connect">
                {row ? "Reconnect" : "Connect Gmail"}
              </Link>
            </Button>
            {row && (
              <>
                <PlainActionButton action={renewWatch} label="Renew watch" />
                <PlainActionButton action={runSyncNow} label="Sync now" />
              </>
            )}
          </div>

          {row && (
            <div className="border-t border-[var(--border)] pt-4">
              <DisconnectForm action={disconnectGmail} email={row.email} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Keeping it alive</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-[var(--muted-foreground)]">
          <p>
            <code className="rounded bg-[var(--muted)] px-1">/api/cron/gmail-watch</code>{" "}
            renews the watch daily. A watch lasts 7 days, so a couple of missed
            runs are survivable.
          </p>
          <p>
            <code className="rounded bg-[var(--muted)] px-1">
              /api/cron/gmail-reconcile
            </code>{" "}
            re-runs the same history sync every 5 minutes. Pushes give speed; this
            gives the guarantee that a dropped push costs minutes, not a lost ticket.
          </p>
          <p>
            Both authenticate with <code>CRON_SECRET</code>, not Cloudflare Access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}
