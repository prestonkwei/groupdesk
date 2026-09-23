"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Pub/Sub gets mail into the database in seconds; this gets it onto the screen.
 * Polls a tiny endpoint every 5s and only calls router.refresh() when something
 * actually changed, so an idle tab costs one cheap query per interval.
 *
 * Swap for Ably/Pusher later by publishing from the ingest pipeline and
 * replacing this hook — nothing else has to change.
 */
export function LiveRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const since = useRef(new Date().toISOString());

  const { data } = useSWR<{ changed: number; now: string }>(
    () => `/api/tickets/updates?since=${encodeURIComponent(since.current)}`,
    fetcher,
    {
      refreshInterval: intervalMs,
      revalidateOnFocus: true,
      refreshWhenHidden: false,
    },
  );

  useEffect(() => {
    if (!data) return;
    if (data.changed > 0) {
      since.current = data.now;
      router.refresh();
    } else if (data.now) {
      since.current = data.now;
    }
  }, [data, router]);

  return null;
}
