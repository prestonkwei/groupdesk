"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Shows the result of the calendar connect flow (?calendar=...) until dismissed. */
export function CalendarNotice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const message = params.get("calendar");
  if (!message) return null;

  const ok = message.startsWith("Connected");
  const dismiss = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("calendar");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div
      role={ok ? "status" : "alert"}
      className={`flex items-center gap-3 border-b px-4 py-2 text-sm ${
        ok
          ? "border-[var(--border)] bg-[var(--card)]"
          : "border-[var(--destructive)] bg-[var(--card)] text-[var(--destructive)]"
      }`}
    >
      <span className="min-w-0 flex-1">{ok ? `Calendar ${message.charAt(0).toLowerCase()}${message.slice(1)}` : message}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-lg leading-none hover:opacity-70">
        ×
      </button>
    </div>
  );
}
