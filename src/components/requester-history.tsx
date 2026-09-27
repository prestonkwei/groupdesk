import Link from "next/link";
import { StatusIcon } from "@/components/ui/ticket-icons";
import { shortDate } from "@/lib/utils";

/** "Other tickets from this person": spot repeat issues at a glance. */
export function RequesterHistory({
  email,
  rows,
  total,
}: {
  email: string;
  rows: { number: number; subject: string; status: string; createdAt: Date }[];
  total: number;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">
        {total === 0 ? "No other tickets from them" : `${total} other ticket${total === 1 ? "" : "s"}`}
      </p>
      {rows.length > 0 && (
        <ul className="-mx-2 space-y-0.5">
          {rows.map((t) => (
            <li key={t.number}>
              <Link
                href={`/tickets/${t.number}`}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]"
              >
                <StatusIcon status={t.status} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t.subject}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    #{t.number} · {shortDate(t.createdAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <Link
          href={`/tickets?view=all&q=${encodeURIComponent(email)}`}
          className="mt-1 block text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
        >
          See all {total}
        </Link>
      )}
    </div>
  );
}
