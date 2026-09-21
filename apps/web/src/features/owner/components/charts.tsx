"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils";

import { formatCompact, formatLongDate, formatNumber, planLabels } from "../lib/format";
import type { LearnerGrowthPoint, PlanCode, PlanFilter } from "../types";

/**
 * The console's charts, drawn as plain SVG.
 *
 * No chart library: the app already renders its charts this way (components/ui/data-display),
 * and a dependency-free chart keeps the Owner bundle small while staying fully themeable —
 * every colour below is a design token, so light and dark both work without a second palette.
 */

/** One colour per plan, all from the theme: blue = free, brand green = premium, amber = top tier. */
export const planColors: Record<PlanCode, string> = {
  free: "var(--info)",
  premium: "var(--primary)",
  unlimited: "var(--warning)",
};

const VIEW_W = 1000;
const VIEW_H = 320;
const PAD = { top: 18, right: 20, bottom: 30, left: 56 };

const stackOrder: PlanCode[] = ["free", "premium", "unlimited"];

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => value <= s * magnitude) ?? 10;
  return step * magnitude;
}

function segmentValue(point: LearnerGrowthPoint, segment: PlanFilter): number {
  return segment === "all" ? point.total : point[segment];
}

function newValue(point: LearnerGrowthPoint, segment: PlanFilter): number {
  if (segment === "free") return point.new_free;
  if (segment === "premium") return point.new_premium;
  if (segment === "unlimited") return point.new_unlimited;
  return point.new_learners;
}

export function LearnerGrowthChart({
  points,
  segment,
  granularity,
  className,
}: {
  points: LearnerGrowthPoint[];
  segment: PlanFilter;
  granularity: "day" | "week";
  className?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const layout = useMemo(() => {
    const innerW = VIEW_W - PAD.left - PAD.right;
    const innerH = VIEW_H - PAD.top - PAD.bottom;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    const max = niceMax(Math.max(...points.map((p) => segmentValue(p, segment)), 1) * 1.08);
    const maxNew = Math.max(...points.map((p) => newValue(p, segment)), 1);

    const x = (index: number) => PAD.left + index * step;
    const y = (value: number) => PAD.top + innerH - (value / max) * innerH;

    /** Cumulative bands when nothing is filtered: the composition of the total is the story. */
    const bands = stackOrder.map((plan, planIndex) => {
      const below = stackOrder.slice(0, planIndex);
      const top = points.map((point) => below.reduce((sum, key) => sum + point[key], 0) + point[plan]);
      const bottom = points.map((point) => below.reduce((sum, key) => sum + point[key], 0));
      const area = [
        ...top.map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(value).toFixed(2)}`),
        ...bottom
          .map((value, i) => `L${x(points.length - 1 - i).toFixed(2)},${y(bottom[points.length - 1 - i]!).toFixed(2)}`)
          .slice(1),
        "Z",
      ].join(" ");
      const line = top.map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
      return { plan, area, line };
    });

    const single = (() => {
      const values = points.map((point) => segmentValue(point, segment));
      const line = values.map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
      const area = `${line} L${x(points.length - 1).toFixed(2)},${y(0).toFixed(2)} L${x(0).toFixed(2)},${y(0).toFixed(2)} Z`;
      return { line, area };
    })();

    const bars = points.map((point, i) => {
      const value = newValue(point, segment);
      const barH = (value / maxNew) * (innerH * 0.22);
      return {
        x: x(i) - Math.max(1.5, step * 0.3),
        width: Math.max(3, step * 0.6),
        y: PAD.top + innerH - barH,
        height: barH,
      };
    });

    const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));

    return { x, y, step, max, bands, single, bars, gridValues, innerH };
  }, [points, segment]);

  if (points.length === 0) {
    return (
      <div className={cn("grid h-64 place-items-center rounded-lg border border-dashed text-body-sm text-fg-muted", className)}>
        No learner data in this period yet.
      </div>
    );
  }

  const active = hover === null ? null : points[Math.min(points.length - 1, Math.max(0, hover))] ?? null;
  const color = segment === "all" ? "var(--primary)" : planColors[segment];

  function pointerIndex(event: PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const xInView = ratio * VIEW_W;
    const index = Math.round((xInView - PAD.left) / (layout.step || 1));
    return Math.min(points.length - 1, Math.max(0, index));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const current = hover ?? points.length - 1;
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : event.key === "ArrowLeft" ? current - 1 : current + 1;
    setHover(Math.min(points.length - 1, Math.max(0, next)));
  }

  const label = `Learner growth, ${points.length} points from ${formatLongDate(points[0]!.date)} to ${formatLongDate(
    points[points.length - 1]!.date,
  )}. Latest total ${formatNumber(segmentValue(points[points.length - 1]!, segment))}.`;

  return (
    <div className={cn("relative", className)}>
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label} Use the arrow keys to read individual points.`}
        onPointerMove={(event) => setHover(pointerIndex(event))}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
        className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-auto w-full touch-pan-y" role="img" aria-label={label}>
          <defs>
            <linearGradient id={`${gradientId}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {layout.gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={layout.y(value)}
                y2={layout.y(value)}
                stroke="var(--border-subtle)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text x={PAD.left - 10} y={layout.y(value) + 4} textAnchor="end" className="fill-[var(--text-muted)] text-[11px]">
                {formatCompact(value)}
              </text>
            </g>
          ))}

          {/* Arrivals per period, behind the curve: the daily texture the cumulative line hides. */}
          {layout.bars.map((bar, i) => (
            <rect key={i} x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={color} opacity={0.14} rx={1.5} />
          ))}

          {segment === "all"
            ? layout.bands.map((band) => (
                <g key={band.plan}>
                  <path d={band.area} fill={planColors[band.plan]} opacity={0.18} />
                  <path
                    d={band.line}
                    fill="none"
                    stroke={planColors[band.plan]}
                    strokeWidth={band.plan === "free" ? 2 : 1.75}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </g>
              ))
            : (
                <>
                  <path d={layout.single.area} fill={`url(#${gradientId}-fill)`} />
                  <path
                    d={layout.single.line}
                    fill="none"
                    stroke={color}
                    strokeWidth={2.25}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </>
              )}

          {active && hover !== null && (
            <g>
              <line
                x1={layout.x(hover)}
                x2={layout.x(hover)}
                y1={PAD.top}
                y2={VIEW_H - PAD.bottom}
                stroke="var(--text-muted)"
                strokeDasharray="3 3"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={layout.x(hover)}
                cy={layout.y(segmentValue(active, segment))}
                r={4.5}
                fill="var(--surface)"
                stroke={color}
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          <line
            x1={PAD.left}
            x2={VIEW_W - PAD.right}
            y1={VIEW_H - PAD.bottom}
            y2={VIEW_H - PAD.bottom}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="mt-1 flex justify-between px-1 text-caption text-fg-muted">
        <span>{formatLongDate(points[0]!.date)}</span>
        <span className="hidden sm:inline">{granularity === "week" ? "Weekly totals" : "Daily totals"}</span>
        <span>{formatLongDate(points[points.length - 1]!.date)}</span>
      </div>

      {active && (
        <GrowthTooltip
          point={active}
          segment={segment}
          granularity={granularity}
          left={`${((layout.x(hover ?? 0) / VIEW_W) * 100).toFixed(2)}%`}
        />
      )}

      {/* The same numbers as text, for screen readers and for anyone who cannot hover. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">New</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatLongDate(point.date)}</th>
              <td>{formatNumber(newValue(point, segment))}</td>
              <td>{formatNumber(segmentValue(point, segment))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrowthTooltip({
  point,
  segment,
  granularity,
  left,
}: {
  point: LearnerGrowthPoint;
  segment: PlanFilter;
  granularity: "day" | "week";
  left: string;
}) {
  const period = granularity === "week" ? "this week" : "";
  const rows =
    segment === "all"
      ? [
          { label: "Free", value: point.free, color: planColors.free },
          { label: "Premium", value: point.premium, color: planColors.premium },
          { label: "Unlimited", value: point.unlimited, color: planColors.unlimited },
        ]
      : [{ label: `Total ${planLabels[segment]}`, value: point[segment], color: planColors[segment] }];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ left, transform: "translateX(-50%)" }}
      className="pointer-events-none absolute top-2 z-10 w-52 max-w-[80vw] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <p className="text-label">{formatLongDate(point.date)}</p>
      <dl className="mt-2 grid gap-1.5 text-body-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-fg-muted">
            {segment === "all" ? "New learners" : `New ${planLabels[segment]}`} {period}
          </dt>
          <dd className="font-medium tabular-nums text-success">+{formatNumber(newValue(point, segment))}</dd>
        </div>
        {segment === "all" && (
          <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
            <dt className="text-fg-muted">Total learners</dt>
            <dd className="font-medium tabular-nums">{formatNumber(point.total)}</dd>
          </div>
        )}
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-fg-muted">
              <span aria-hidden className="size-2 rounded-full" style={{ background: row.color }} />
              {row.label}
            </dt>
            <dd className="tabular-nums">{formatNumber(row.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Subscription split. A ring rather than a pie: the middle carries the total. */
export function DonutChart({
  slices,
  total,
  label,
  className,
}: {
  slices: { key: string; label: string; value: number; color: string }[];
  total: number;
  label: string;
  className?: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  // Offsets are derived up front: each arc starts where the previous ones ended.
  const arcs = slices.map((slice, index) => {
    const dash = (total > 0 ? slice.value / total : 0) * circumference;
    const offset = slices
      .slice(0, index)
      .reduce((sum, previous) => sum + (total > 0 ? previous.value / total : 0) * circumference, 0);
    return { slice, dash, offset };
  });

  return (
    <div className={cn("flex items-center gap-5", className)}>
      <svg viewBox="0 0 140 140" className="size-32 shrink-0 -rotate-90" role="img" aria-label={label}>
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface-active)" strokeWidth={16} />
        {arcs.map(({ slice, dash, offset }) => (
          <circle
            key={slice.key}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth={16}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
          />
        ))}
      </svg>
      <ul className="grid min-w-0 flex-1 gap-2">
        {slices.map((slice) => (
          <li key={slice.key} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-body-sm">
              <span className="flex items-center gap-2 truncate">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
                {slice.label}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatNumber(slice.value)}
                <span className="ml-1.5 text-fg-muted">
                  {total > 0 ? `${((slice.value / total) * 100).toFixed(1)}%` : "0%"}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A labelled horizontal bar list — content per skill, activity per period. */
export function BarList({
  items,
  className,
}: {
  items: { key: string; label: string; value: number; display?: string; hint?: string; color?: string }[];
  className?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className={cn("grid gap-3", className)}>
      {items.map((item) => (
        <li key={item.key} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums">{item.display ?? formatNumber(item.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-active">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, background: item.color ?? "var(--primary)" }}
            />
          </div>
          {item.hint && <p className="text-caption text-fg-muted">{item.hint}</p>}
        </li>
      ))}
    </ul>
  );
}
