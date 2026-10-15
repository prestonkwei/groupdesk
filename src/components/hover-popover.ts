"use client";

/**
 * The hover/pin state machine behind date popovers. Kept apart from the chips
 * themselves (which pull in the date parser) so message bodies can use it
 * without loading that code when the date detector is off.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DateMatch } from "@/lib/dates";

export type Anchor = {
  /** Unique per chip in the document; keys the popover so state never carries between chips. */
  id: string;
  match: DateMatch;
  rect: { left: number; top: number; width: number; height: number };
};

/**
 * Hover opens after a beat; leaving both chip and popover closes it; a click
 * pins it. The returned callbacks keep one identity for the life of the
 * component, so listeners attached once (inside an iframe) never go stale.
 */
export function useHoverPopover() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinnedState] = useState(false);
  const pinnedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPinned = useCallback((v: boolean) => {
    pinnedRef.current = v;
    setPinnedState(v);
  }, []);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const enter = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(true), 200);
  }, [clear]);
  const leave = useCallback(() => {
    clear();
    if (pinnedRef.current) return;
    timer.current = setTimeout(() => setOpen(false), 250);
  }, [clear]);
  const pin = useCallback(() => {
    clear();
    setPinned(true);
    setOpen(true);
  }, [clear, setPinned]);
  const close = useCallback(() => {
    clear();
    setPinned(false);
    setOpen(false);
  }, [clear, setPinned]);
  useEffect(() => clear, [clear]);
  return { open, pinned, enter, leave, pin, close };
}
