"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

export type Viewer = { name: string; email: string; replying: boolean };
type UpdatesResponse = { changed: number; now: string; viewers?: Viewer[] };

/**
 * Pub/Sub gets mail into the database in seconds; this gets it onto the screen.
 * Polls a tiny endpoint every 5s and only calls router.refresh() when something
 * actually changed, so an idle tab costs one cheap query per interval. On a
 * ticket page the same request carries presence ("viewing" / "replying").
 *
 * Swap for Ably/Pusher later by publishing from the ingest pipeline and
 * replacing this hook — nothing else has to change.
 */
export function LiveRefresh({
  intervalMs = 5000,
  ticketId,
  replying = false,
  onViewers,
}: {
  intervalMs?: number;
  ticketId?: string;
  replying?: boolean;
  onViewers?: (viewers: Viewer[]) => void;
}) {
  const router = useRouter();
  const since = useRef(new Date().toISOString());

  // The key only changes with the ticket or replying state (so a change is
  // announced at once); `since` is read when the request runs, so the poll
  // keeps its interval instead of refiring on every render.
  const { data } = useSWR<UpdatesResponse>(
    ["tickets/updates", ticketId ?? "", replying],
    () => {
      const p = new URLSearchParams({ since: since.current });
      if (ticketId) {
        p.set("ticket", ticketId);
        p.set("replying", replying ? "1" : "0");
      }
      return fetch(`/api/tickets/updates?${p}`).then((r) => r.json());
    },
    {
      refreshInterval: intervalMs,
      revalidateOnFocus: true,
      refreshWhenHidden: false,
    },
  );

  const lastViewers = useRef("");
  useEffect(() => {
    if (!data) return;
    const v = JSON.stringify(data.viewers ?? []);
    if (data.viewers && onViewers && v !== lastViewers.current) {
      lastViewers.current = v;
      onViewers(data.viewers);
    }
    if (data.changed > 0) {
      since.current = data.now;
      router.refresh();
    } else if (data.now) {
      since.current = data.now;
    }
  }, [data, router, onViewers]);

  return null;
}
