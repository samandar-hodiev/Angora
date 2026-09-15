import * as React from "react";

import { cn } from "@/lib/utils";

// ---- ProgressRing -----------------------------------------------------------------------

/** Circular progress (0–100). Decorative ring + an accessible value. */
export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  label,
  className,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-active)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-emphasis ease-emphasized"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-label tabular-nums">{children}</div>
    </div>
  );
}

// ---- Meter (horizontal bar with label) ------------------------------------------------------

export function Meter({
  label,
  value,
  max = 100,
  display,
  tone = "primary",
  glow = false,
  className,
}: {
  label: React.ReactNode;
  value: number;
  max?: number;
  display?: React.ReactNode;
  tone?: "primary" | "success" | "warning" | "error" | "muted";
  /** Soft glow around the filled part (hero/marketing progress only). */
  glow?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    error: "bg-error",
    muted: "bg-fg-muted",
  }[tone];
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-body-sm">
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-fg-muted tabular-nums">{display ?? `${Math.round(pct)}%`}</span>
      </div>
      <div
        role="meter"
        aria-label={typeof label === "string" ? label : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-1.5 overflow-hidden rounded-full bg-surface-active"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-emphasis ease-emphasized", color, glow && "shadow-[0_0_12px_0_var(--primary-glow)]")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---- Charts (dependency-free SVG) ----------------------------------------------------------

/** Vertical bar chart for small series (e.g. daily AI cost). */
export function BarChart({
  data,
  height = 140,
  label,
  formatValue = (v) => String(v),
}: {
  data: { label: string; value: number }[];
  height?: number;
  label: string;
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  return (
    <figure className="grid gap-2">
      <div role="img" aria-label={label} className="flex items-end gap-1" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t-sm bg-primary/80 transition-colors duration-micro group-hover:bg-primary"
              style={{ height: `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%` }}
            />
            <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-caption whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100">
              {formatValue(d.value)}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="flex justify-between text-caption text-fg-muted">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </figcaption>
    </figure>
  );
}

/** Minimal trend line. */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / range) * 28 - 1}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label} className={cn("h-8 w-full", className)}>
      <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Stat ----------------------------------------------------------------------------------

export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1 rounded-lg border bg-surface p-4", className)}>
      <div className="flex items-center gap-2 text-label text-fg-muted">
        {Icon && <Icon className="size-4" aria-hidden />}
        {label}
      </div>
      <div className="text-h2 tabular-nums">{value}</div>
      {hint && <div className="text-caption text-fg-muted">{hint}</div>}
    </div>
  );
}
