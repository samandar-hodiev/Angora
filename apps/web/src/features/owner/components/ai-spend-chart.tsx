"use client";

import { FlaskConical, Sparkles } from "lucide-react";
import { useId, useState, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { formatCompact, formatNumber } from "../lib/format";
import type { AITimeline } from "../services/assessments";

/**
 * AI spend over time, one line per provider — each in its own colour, with its own mark — and
 * a tooltip that reads every provider's tokens and dollars at the hovered moment. Providers
 * can be switched off above the chart, so one large line does not flatten the others.
 *
 * Plain SVG, like the rest of the console's charts (see charts.tsx): no chart library.
 */

type Metric = "tokens" | "cost";

interface ProviderMeta {
  label: string;
  color: string;
  logo: (props: { className?: string }) => ReactNode;
}

function OpenAILogo({ className }: { className?: string }) {
  // The interlocking knot, drawn as six rounded strokes around a centre.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.9}>
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <path key={deg} d="M12 4.2a4 4 0 0 1 3.9 3.1L12 9.6 8.1 7.3A4 4 0 0 1 12 4.2Z" transform={`rotate(${deg} 12 12)`} />
      ))}
    </svg>
  );
}

function AnthropicLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M14.2 4h-3.1l5.6 16h3.1L14.2 4ZM9.8 4 4.2 20h3.2l1.1-3.3h5.8L15.4 20h3.2L13 4H9.8Zm-.4 10 2-5.8 2 5.8h-4Z" />
    </svg>
  );
}

function GeminiLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10Z" />
    </svg>
  );
}

const providerMeta: Record<string, ProviderMeta> = {
  openai: { label: "OpenAI", color: "#10a37f", logo: OpenAILogo },
  anthropic: { label: "Anthropic", color: "#d97757", logo: AnthropicLogo },
  google: { label: "Google Gemini", color: "#4285f4", logo: GeminiLogo },
  gemini: { label: "Google Gemini", color: "#4285f4", logo: GeminiLogo },
  mock: { label: "Mock (development)", color: "#8b8f98", logo: ({ className }) => <FlaskConical className={className} aria-hidden /> },
};

const fallbackColors = ["#a78bfa", "#f472b6", "#facc15", "#22d3ee"];

export function metaFor(provider: string, index = 0): ProviderMeta {
  return (
    providerMeta[provider.toLowerCase()] ?? {
      label: provider,
      color: fallbackColors[index % fallbackColors.length]!,
      logo: ({ className }) => <Sparkles className={className} aria-hidden />,
    }
  );
}

export function ProviderMark({ provider, index = 0, className }: { provider: string; index?: number; className?: string }) {
  const meta = metaFor(provider, index);
  const Logo = meta.logo;
  return (
    <span
      className={cn("grid size-6 shrink-0 place-items-center rounded-md", className)}
      style={{ color: meta.color, backgroundColor: `color-mix(in oklch, ${meta.color} 16%, transparent)` }}
    >
      <Logo className="size-3.5" />
    </span>
  );
}

export function formatUSD(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

const VIEW_W = 1000;
const VIEW_H = 300;
const PAD = { top: 16, right: 20, bottom: 30, left: 60 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => value <= s * magnitude) ?? 10;
  return step * magnitude;
}

export function AISpendChart({ timeline }: { timeline: AITimeline }) {
  const gradient = useId();
  const [metric, setMetric] = useState<Metric>("tokens");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const providers = timeline.providers.map((p) => p.provider);
  const visible = providers.filter((p) => !off.has(p));
  const points = timeline.points;

  const valueOf = (i: number, provider: string) => {
    const v = points[i]?.by_provider[provider];
    return v ? (metric === "tokens" ? v.tokens : v.cost_usd) : 0;
  };

  // Cheap enough to work out on every render: a few dozen points per provider.
  const layout = (() => {
    const innerW = VIEW_W - PAD.left - PAD.right;
    const innerH = VIEW_H - PAD.top - PAD.bottom;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    let top = 0;
    for (let i = 0; i < points.length; i++) for (const p of visible) top = Math.max(top, valueOf(i, p));
    const max = niceMax(top * 1.1);
    const x = (i: number) => PAD.left + i * step;
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const series = visible.map((provider) => {
      const line = points.map((_, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(valueOf(i, provider)).toFixed(1)}`).join(" ");
      const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
      return { provider, line, area };
    });
    return { x, y, step, max, series, grid: [0, 0.25, 0.5, 0.75, 1].map((r) => max * r) };
  })();

  const label = (at: string) => {
    const d = new Date(at);
    return timeline.bucket === "hour"
      ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  function onMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const xIn = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round((xIn - PAD.left) / (layout.step || 1)))));
  }

  const toggle = (provider: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });

  const yLabel = (v: number) => (metric === "tokens" ? formatCompact(Math.round(v)) : formatUSD(v));
  const active = hover === null ? null : points[hover];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {timeline.providers.map((p, i) => {
          const on = !off.has(p.provider);
          const meta = metaFor(p.provider, i);
          return (
            <button
              key={p.provider}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => toggle(p.provider)}
              title={`${meta.label} — switch ${on ? "off" : "on"}`}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-body-sm outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
                on ? "bg-surface" : "bg-transparent opacity-55",
              )}
              style={on ? { borderColor: `color-mix(in oklch, ${meta.color} 55%, transparent)` } : undefined}
            >
              <ProviderMark provider={p.provider} index={i} />
              <span className="font-medium">{meta.label}</span>
              <span className="text-caption text-fg-muted tabular-nums">
                {formatCompact(p.input_tokens + p.output_tokens)} · {formatUSD(p.cost_usd)}
              </span>
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-px text-[0.625rem] font-semibold uppercase",
                  on ? "bg-success/15 text-success" : "bg-surface-active text-fg-muted",
                )}
              >
                {on ? "On" : "Off"}
              </span>
            </button>
          );
        })}
        <div role="group" aria-label="Measure" className="ml-auto inline-flex rounded-lg border bg-surface p-0.5">
          {(["tokens", "cost"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={cn(
                "rounded-md px-2.5 py-1 text-caption font-medium",
                metric === m ? "bg-surface-active text-foreground" : "text-fg-muted hover:text-foreground",
              )}
            >
              {m === "tokens" ? "Tokens" : "USD"}
            </button>
          ))}
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="grid h-56 place-items-center rounded-lg border border-dashed text-body-sm text-fg-muted">
          No AI calls in this period yet.
        </p>
      ) : (
        <div className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-auto w-full touch-pan-y" role="img" aria-label="AI spend by provider over time">
            <defs>
              {layout.series.map((s) => {
                const color = metaFor(s.provider, providers.indexOf(s.provider)).color;
                return (
                  <linearGradient key={s.provider} id={`${gradient}-${s.provider}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                  </linearGradient>
                );
              })}
            </defs>
            {layout.grid.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={layout.y(v)} y2={layout.y(v)} stroke="var(--border-subtle)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <text x={PAD.left - 10} y={layout.y(v) + 4} textAnchor="end" className="fill-[var(--text-muted)] text-[11px]">
                  {yLabel(v)}
                </text>
              </g>
            ))}
            {layout.series.map((s) => {
              const color = metaFor(s.provider, providers.indexOf(s.provider)).color;
              return (
                <g key={s.provider}>
                  <path d={s.area} fill={`url(#${gradient}-${s.provider})`} />
                  <path d={s.line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </g>
              );
            })}
            {hover !== null && (
              <line x1={layout.x(hover)} x2={layout.x(hover)} y1={PAD.top} y2={VIEW_H - PAD.bottom} stroke="var(--fg-muted)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
            {hover !== null &&
              layout.series.map((s) => (
                <circle
                  key={s.provider}
                  cx={layout.x(hover)}
                  cy={layout.y(valueOf(hover, s.provider))}
                  r={4.5}
                  fill="var(--background)"
                  stroke={metaFor(s.provider, providers.indexOf(s.provider)).color}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {points.length > 0 &&
              [0, Math.floor((points.length - 1) / 2), points.length - 1].map((i, k) => (
                <text
                  key={`${i}-${k}`}
                  x={layout.x(i)}
                  y={VIEW_H - 8}
                  textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
                  className="fill-[var(--text-muted)] text-[11px]"
                >
                  {label(points[i]!.at)}
                </text>
              ))}
          </svg>

          {active && hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-60 rounded-lg border bg-surface-elevated p-3 text-caption shadow-lg"
              style={{
                left: `${(layout.x(hover) / VIEW_W) * 100}%`,
                transform: hover > points.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              }}
            >
              <p className="mb-2 font-medium text-foreground">
                {timeline.bucket === "hour"
                  ? new Date(active.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                  : new Date(active.at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </p>
              <ul className="grid gap-1.5">
                {visible.map((provider) => {
                  const v = active.by_provider[provider] ?? { tokens: 0, cost_usd: 0, requests: 0 };
                  return (
                    <li key={provider} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                      <ProviderMark provider={provider} index={providers.indexOf(provider)} className="size-5" />
                      <span className="truncate text-fg-secondary">{metaFor(provider, providers.indexOf(provider)).label}</span>
                      <span className="text-right tabular-nums">
                        <span className="text-foreground">{formatNumber(v.tokens)}</span> tok
                        <span className="block text-fg-muted">
                          {formatUSD(v.cost_usd)} · {formatNumber(v.requests)} req
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
