"use client";

import { Bot, Hand, RefreshCw, Send, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { LearnerAvatar, SectionCard } from "../components/primitives";
import { useActivity } from "../hooks";
import { formatDateTime, formatNumber, formatRelative } from "../lib/format";
import type { ActivityCounts, ActivityEvent } from "../services/assessments";

/**
 * What the team did to the content. Not the audit log — that is sign-ins and settings — but
 * the work itself: who wrote, generated, regenerated, edited, published or deleted which
 * grammar topic, word, phrase, collocation or verb, and whether the AI or a person wrote it.
 */

const areas = [
  { value: "", label: "Everything" },
  { value: "grammar", label: "Grammar" },
  { value: "vocabulary", label: "Vocabulary" },
  { value: "phrases", label: "Phrases" },
  { value: "collocations", label: "Collocations" },
  { value: "irregular_verbs", label: "Irregular verbs" },
] as const;

const areaLabel: Record<string, string> = Object.fromEntries(areas.filter((a) => a.value).map((a) => [a.value, a.label]));

const kindLabel: Record<string, string> = {
  generated: "Generated",
  regenerated: "Regenerated",
  improved: "Improved with AI",
  translated: "Translated",
  created: "Created",
  edited: "Edited",
  published: "Published",
  archived: "Archived",
  deleted: "Deleted",
  status_changed: "Changed status",
};

const roleLabel: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  CONTENT_MANAGER: "Content manager",
  SUPPORT: "Support",
  ANALYST: "Analyst",
};

export function TeamActivity({ days }: { days: number }) {
  const [area, setArea] = useState("");
  const [actor, setActor] = useState<string | null>(null);
  // "3 minutes ago" is measured from when the page was opened, not re-read every render.
  const [now] = useState(() => new Date().toISOString());
  const all = useActivity({ days });
  const filtered = useActivity({ days, area: area || undefined, actor: actor ?? undefined });

  if (all.isError) return <LiveDataState error={all.error} onRetry={() => void all.refetch()} />;
  const report = all.data;
  const person = report?.workers.find((w) => w.id === actor);

  return (
    <div className="grid gap-5">
      <div role="group" aria-label="Area" className="flex flex-wrap gap-2">
        {areas.map((a) => {
          const count = a.value ? (report?.by_area[a.value]?.total ?? 0) : report?.workers.reduce((n, w) => n + w.total, 0) ?? 0;
          const active = area === a.value;
          return (
            <button
              key={a.value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setArea(a.value)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-body-sm outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
                active ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
              )}
            >
              {a.label}
              <span className="text-caption text-fg-muted tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      <SectionCard title="Team" description="Who did the work in this period — click a person to see only theirs">
        {!report ? (
          <Skeleton className="h-28 w-full" />
        ) : report.workers.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-fg-muted">Nobody changed any content in this period.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {report.workers.map((w) => {
              const selected = actor === w.id;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActor(selected ? null : w.id)}
                    className={cn(
                      "grid w-full gap-3 rounded-xl border p-4 text-left outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      selected ? "border-primary bg-primary-subtle/40" : "bg-surface hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <LearnerAvatar name={w.name} avatarUrl={w.avatar_url} size="sm" />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate text-body-sm font-medium">{w.name}</span>
                        <span className="truncate text-caption text-fg-muted">{w.email}</span>
                      </span>
                      <Badge variant="outline">{roleLabel[w.role] ?? w.role}</Badge>
                    </span>
                    <Counts counts={w} />
                    <span className="text-caption text-fg-muted">Last active {formatRelative(w.last_at, now)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title={person ? `What ${person.name} did` : "Every change"}
        description={`${areaLabel[area] ?? "All areas"} · newest first`}
        action={
          person ? (
            <button
              type="button"
              onClick={() => setActor(null)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-caption text-fg-muted hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden /> Everyone
            </button>
          ) : undefined
        }
      >
        {filtered.isPending || !filtered.data ? (
          <Skeleton className="h-48 w-full" />
        ) : filtered.data.events.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-fg-muted">No changes match.</p>
        ) : (
          <ol className="divide-y">
            {filtered.data.events.map((e, i) => (
              <EventRow key={`${e.at}-${i}`} event={e} now={now} />
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}

function Counts({ counts }: { counts: ActivityCounts }) {
  const items = [
    { label: "AI", value: counts.ai, icon: Bot, tone: "text-[#10a37f]" },
    { label: "By hand", value: counts.manual, icon: Hand, tone: "text-info" },
    { label: "Regenerated", value: counts.regenerated, icon: RefreshCw, tone: "text-warning-text" },
    { label: "Published", value: counts.published, icon: Send, tone: "text-success" },
    { label: "Deleted", value: counts.deleted, icon: Trash2, tone: "text-error" },
  ];
  return (
    <span className="grid grid-cols-5 gap-1.5">
      {items.map(({ label, value, icon: Icon, tone }) => (
        <span key={label} className="grid justify-items-center gap-0.5 rounded-lg bg-surface-active/50 px-1 py-1.5" title={label}>
          <Icon className={cn("size-3.5", tone)} aria-hidden />
          <span className="text-body-sm font-semibold tabular-nums">{formatNumber(value)}</span>
          <span className="truncate text-[0.625rem] text-fg-muted">{label}</span>
        </span>
      ))}
    </span>
  );
}

function EventRow({ event: e, now }: { event: ActivityEvent; now: string }) {
  const ai = e.method === "ai" || e.kind === "regenerated" || e.kind === "improved" || e.kind === "translated";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <LearnerAvatar name={e.actor.name} avatarUrl={e.actor.avatar_url} size="sm" />
      <span className="grid min-w-0 flex-1 basis-72 gap-0.5">
        <span className="text-body-sm">
          <span className="font-medium">{e.actor.name}</span>{" "}
          <span className="text-fg-secondary">{(kindLabel[e.kind] ?? e.kind).toLowerCase()}</span>{" "}
          {e.count > 1 && <span className="font-medium tabular-nums">{formatNumber(e.count)} </span>}
          <span className="font-medium">{e.target || areaLabel[e.area] || e.area}</span>
        </span>
        {e.detail && <span className="truncate text-caption text-fg-muted">{e.detail}</span>}
      </span>
      <Badge variant="outline">{areaLabel[e.area] ?? e.area}</Badge>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold",
          ai ? "bg-[#10a37f]/15 text-[#10a37f]" : "bg-info/15 text-info",
        )}
      >
        {ai ? <Bot className="size-3" aria-hidden /> : <Hand className="size-3" aria-hidden />}
        {ai ? "AI" : "By hand"}
      </span>
      <time className="w-36 shrink-0 text-right text-caption text-fg-muted tabular-nums" dateTime={e.at} title={formatDateTime(e.at)}>
        {formatRelative(e.at, now)}
      </time>
    </li>
  );
}
