"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A side panel you can resize by dragging its inner edge (double-click to
 * reset). The width is kept in a cookie so the server renders it at the
 * right size on the next load, with no jump.
 */
export function ResizablePanel({
  id,
  side,
  initialWidth,
  defaultWidth,
  min,
  max,
  className,
  children,
}: {
  /** Cookie name, e.g. "sidebar-w". */
  id: string;
  /** Which side of the screen the panel sits on; the handle is on the inner edge. */
  side: "left" | "right";
  initialWidth?: number;
  defaultWidth: number;
  min: number;
  max: number;
  className?: string;
  children: React.ReactNode;
}) {
  const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)));
  const [width, setWidth] = useState(clamp(initialWidth ?? defaultWidth));
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; w: number } | null>(null);

  function save(w: number) {
    document.cookie = `${id}=${w}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className={cn("relative flex min-h-0 shrink-0", className)} style={{ width }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label="Resize panel"
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, w: width };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const dx = e.clientX - start.current.x;
          setWidth(clamp(start.current.w + (side === "left" ? dx : -dx)));
        }}
        onPointerUp={() => {
          start.current = null;
          setDragging(false);
          save(width);
        }}
        onDoubleClick={() => {
          setWidth(defaultWidth);
          save(defaultWidth);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 10;
          const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
          const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
          if (e.key !== grow && e.key !== shrink) return;
          e.preventDefault();
          const w = clamp(width + (e.key === grow ? step : -step));
          setWidth(w);
          save(w);
        }}
        className={cn(
          "group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none",
          side === "left" ? "-right-1" : "-left-1",
        )}
      >
        <span
          className={cn(
            "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors",
            dragging
              ? "bg-[var(--primary)]"
              : "bg-transparent group-hover:bg-[var(--border)] group-focus-visible:bg-[var(--ring)]",
          )}
        />
      </div>
      {/* Keep text from being selected and iframes from eating the drag. */}
      {dragging && <div className="fixed inset-0 z-10 cursor-col-resize select-none" />}
    </div>
  );
}
