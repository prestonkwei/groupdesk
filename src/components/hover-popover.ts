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
  /** Index of the chip's client rect (one per rendered line) that was hovered or clicked. */
  line: number;
};

/**
 * Hover opens after a beat; leaving both chip and popover closes it; a click
 * pins it. The returned callbacks keep one identity for the life of the
 * component, so handlers memoised on them (the overlay handlers in HtmlBody)
 * don't change on every render. `pinnedRef` lets those handlers read the
 * pin state without depending on it.
 */
export function useHoverPopover() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinnedState] = useState(false);
  const pinnedRef = useRef(false);
  const openRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpenNow = useCallback((v: boolean) => {
    openRef.current = v;
    setOpen(v);
  }, []);
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
    timer.current = setTimeout(() => setOpenNow(true), 200);
  }, [clear, setOpenNow]);
  const leave = useCallback(() => {
    clear();
    if (pinnedRef.current) return;
    timer.current = setTimeout(() => setOpenNow(false), 250);
  }, [clear, setOpenNow]);
  const pin = useCallback(() => {
    clear();
    setPinned(true);
    setOpenNow(true);
  }, [clear, setPinned, setOpenNow]);
  const close = useCallback(() => {
    clear();
    setPinned(false);
    setOpenNow(false);
  }, [clear, setPinned, setOpenNow]);
  /** Closes an open, unpinned popover (the anchor moved or vanished); a pending hover-open is left alone. */
  const dismiss = useCallback(() => {
    if (pinnedRef.current || !openRef.current) return;
    clear();
    setOpenNow(false);
  }, [clear, setOpenNow]);
  useEffect(() => clear, [clear]);
  return { open, pinned, pinnedRef, enter, leave, pin, close, dismiss };
}
