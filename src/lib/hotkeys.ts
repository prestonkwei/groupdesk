"use client";

import { useEffect, useRef } from "react";

/**
 * Keys are matched on `event.key`: "j", "?", "Enter", "Escape". Prefix "mod+"
 * for ⌘ on macOS / Ctrl elsewhere. Two keys separated by a space ("g i") form
 * a sequence: the second must follow within a second.
 *
 * Plain keys (Escape included) are ignored while typing in a field or while a
 * dialog/picker is open, so they never fight the focused control; "mod+"
 * combos still fire.
 */
export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

function typingIn(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

function overlayOpen() {
  return !!document.querySelector("[data-radix-popper-content-wrapper], [data-hotkeys-dialog]");
}

export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });

  useEffect(() => {
    if (!enabled) return;
    let pending: { key: string; at: number } | null = null;

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const bindings = ref.current;

      if (mod) {
        const handler = bindings[`mod+${e.key.toLowerCase()}`] ?? bindings[`mod+${e.key}`];
        if (handler) {
          e.preventDefault();
          handler(e);
        }
        return;
      }
      if (e.altKey) return;

      if (typingIn(e.target) || overlayOpen()) return;

      if (pending && Date.now() - pending.at < 1000) {
        const seq = bindings[`${pending.key} ${e.key}`];
        pending = null;
        if (seq) {
          e.preventDefault();
          seq(e);
          return;
        }
      }

      if (Object.keys(bindings).some((k) => k.startsWith(`${e.key} `))) {
        pending = { key: e.key, at: Date.now() };
        return;
      }

      const handler = bindings[e.key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
