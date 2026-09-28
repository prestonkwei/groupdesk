"use client";

import { useEffect, useRef, useState } from "react";
import { TIME_ZONE } from "@/lib/utils";

type Point = { date: string; created: number; resolved: number };

const SERIES = [
  { key: "created", label: "Came in", color: "var(--series-1)" },
  { key: "resolved", label: "Resolved", color: "var(--series-2)" },
] as const;

const H = 220;
const PAD = { top: 12, right: 92, bottom: 26, left: 32 };

function niceMax(n: number) {
  if (n <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.ceil(n / step) * step;
}

function label(date: string, weekly: boolean) {
  const d = new Date(`${date}T12:00:00Z`);
  const s = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return weekly ? `Week of ${s}` : s;
}

/**
 * Tickets in vs resolved over time: two 2px lines on one axis, a legend,
 * end-of-line labels, a crosshair tooltip that reads out both series at the
 * hovered date (also driven by ←/→ when focused), and a table view.
 */
export function VolumeChart({ data, weekly }: { data: Point[]; weekly: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.created, d.resolved])));
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = (key: "created" | "resolved") =>
    data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join("");
  const ticks = [0, max / 2, max];
  const xLabels = data.length > 1 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [0];
  const last = data[data.length - 1];

  function pick(clientX: number) {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || !data.length) return;
    const rel = clientX - box.left - PAD.left;
    const i = Math.round((rel / innerW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  }

  const totals = {
    created: data.reduce((n, d) => n + d.created, 0),
    resolved: data.reduce((n, d) => n + d.resolved, 0),
  };

  return (
    <div className="viz-root">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-[var(--muted-foreground)]">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden>
              <line x1="1" y1="4" x2="15" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {s.label}
            <span className="font-medium text-[var(--foreground)]">{totals[s.key]}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAsTable((t) => !t)}
          className="ml-auto hover:text-[var(--foreground)] hover:underline"
        >
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--muted)] text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">{weekly ? "Week" : "Day"}</th>
                <th className="px-3 py-1.5 text-right font-medium">Came in</th>
                <th className="px-3 py-1.5 text-right font-medium">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t border-[var(--border)]">
                  <td className="px-3 py-1.5">{label(d.date, weekly)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.created}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={wrap}
          className="relative outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          tabIndex={0}
          role="img"
          aria-label={`Tickets in and resolved per ${weekly ? "week" : "day"} in ${TIME_ZONE} time. ${totals.created} came in, ${totals.resolved} resolved.`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? data.length) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(data.length - 1, (h ?? -1) + 1));
          }}
        >
          <svg width={width} height={H} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--muted-foreground)] text-[10px]">
                  {t}
                </text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                className="fill-[var(--muted-foreground)] text-[10px]"
              >
                {data[i] && label(data[i].date, false)}
              </text>
            ))}

            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.5" />
            )}

            {SERIES.map((s) => (
              <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {hover !== null &&
              SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(data[hover][s.key])}
                  r="4"
                  fill={s.color}
                  stroke="var(--card)"
                  strokeWidth="2"
                />
              ))}

            {/* Direct labels at the line ends; nudged apart if they'd collide. */}
            {last &&
              (() => {
                const yc = y(last.created);
                let yr = y(last.resolved);
                if (Math.abs(yc - yr) < 14) yr = yc + (yr >= yc ? 14 : -14);
                return SERIES.map((s) => (
                  <text
                    key={s.key}
                    x={x(data.length - 1) + 8}
                    y={s.key === "created" ? yc : yr}
                    dy="0.32em"
                    className="fill-[var(--foreground)] text-[11px]"
                  >
                    {s.label} {last[s.key]}
                  </text>
                ));
              })()}
          </svg>

          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-md"
              style={{
                left: Math.min(Math.max(x(hover) + 12, 0), width - 170),
              }}
            >
              <p className="mb-1 text-[var(--muted-foreground)]">{label(data[hover].date, weekly)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center gap-2">
                  <svg width="12" height="6" aria-hidden>
                    <line x1="1" y1="3" x2="11" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="font-semibold tabular-nums">{data[hover][s.key]}</span>
                  <span className="text-[var(--muted-foreground)]">{s.label}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
