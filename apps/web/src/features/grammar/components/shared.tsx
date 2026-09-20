"use client";

import { CircleCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { GrammarState, GrammarTopicSummary } from "@engora/types";
import { cn } from "@/lib/utils";

/**
 * The pieces every grammar surface shares. A topic must look and read the same in the
 * library, in search results, in a relation link and in a recommendation — otherwise the
 * learner has to re-learn the interface on every screen.
 */

const stateLabels: Record<GrammarState, string> = {
  not_started: "Not started",
  learning: "Learning",
  practicing: "Practising",
  developing: "Developing",
  mastered: "Mastered",
};

/** Colour carries the same meaning everywhere: amber needs work, green is done. */
export function MasteryDot({ state, mastery }: { state: GrammarState; mastery: number }) {
  const tone =
    state === "mastered" ? "bg-success" : mastery >= 50 ? "bg-primary" : mastery > 0 ? "bg-warning" : "bg-border";
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone)} />;
}

export function StateBadge({ state, mastery }: { state: GrammarState; mastery: number }) {
  if (state === "not_started") return null;
  if (state === "mastered") {
    return (
      <Badge variant="success" className="gap-1">
        <CircleCheck aria-hidden />
        Mastered
      </Badge>
    );
  }
  return (
    <Badge variant={mastery < 50 ? "warning" : "outline"}>
      {stateLabels[state]} · {Math.round(mastery)}%
    </Badge>
  );
}

/**
 * A thin mastery bar. It sits inside dense lists where a full Meter would dominate the row,
 * so it is deliberately quiet: no label, no number, just the shape of the progress.
 */
export function MasteryBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const tone = pct >= 80 ? "bg-success" : pct >= 50 ? "bg-primary" : "bg-warning";
  return (
    <span
      role="img"
      aria-label={`${Math.round(pct)}% mastery`}
      className={cn("block h-1 w-full overflow-hidden rounded-full bg-surface-active", className)}
    >
      <span className={cn("block h-full rounded-full transition-[width] duration-normal", tone)} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function LevelBadge({ level }: { level: string | null }) {
  if (!level) return null;
  return <Badge variant="outline">{level}</Badge>;
}

/**
 * One topic in a list. `highlight` marks the part of the name a search matched, so the
 * learner can see why a result is there rather than guessing.
 */
export function TopicRow({
  topic,
  highlight,
  trailing,
  className,
}: {
  topic: GrammarTopicSummary;
  highlight?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/app/grammar/${topic.slug}`}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors duration-micro",
        "hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
    >
      <MasteryDot state={topic.state} mastery={topic.mastery} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-body-sm font-medium">{highlightMatch(topic.name, highlight)}</span>
          <LevelBadge level={topic.level} />
          {topic.ielts_relevant && <Badge variant="secondary">IELTS</Badge>}
        </span>
        {topic.description && <span className="mt-0.5 block truncate text-caption text-fg-muted">{topic.description}</span>}
      </span>
      {trailing ?? (
        topic.mastery > 0 ? (
          <span className="hidden w-20 shrink-0 sm:block">
            <MasteryBar value={topic.mastery} />
          </span>
        ) : (
          <span className="shrink-0 text-caption text-fg-muted">{topic.estimated_minutes} min</span>
        )
      )}
    </Link>
  );
}

/** Wraps every case-insensitive occurrence of `term` in a <mark>. */
export function highlightMatch(text: string, term?: string): ReactNode {
  const needle = term?.trim();
  if (!needle) return text;

  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (let i = lower.indexOf(target); i !== -1; i = lower.indexOf(target, cursor)) {
    if (i > cursor) parts.push(text.slice(cursor, i));
    parts.push(
      <mark key={i} className="rounded-xs bg-primary-subtle px-0.5 text-primary-subtle-foreground">
        {text.slice(i, i + needle.length)}
      </mark>,
    );
    cursor = i + needle.length;
  }
  if (cursor === 0) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/** Marks a block as AI-generated, so it never reads as the product's own rule. */
export function AIBadge({ cached }: { cached?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-caption text-fg-muted">
      <Sparkles className="size-3 text-primary" aria-hidden />
      AI{cached ? " · saved" : ""}
    </span>
  );
}
