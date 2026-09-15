"use client";

import type { VocabularyCard as VocabularyCardData } from "@engora/types";
import { ArrowRight, Check, Sparkles, Volume2, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LiquidBackground } from "@/components/common/liquid-background";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Tooltip } from "@/components/ui/overlay";
import { formatCategory, severityTone } from "@/lib/learning-format";
import { cn } from "@/lib/utils";

import { SkillIcon } from "./skill-icon";

// ---- SkillCard ------------------------------------------------------------------------------

export function SkillCard({
  code,
  name,
  description,
  score,
  href,
  meta,
  className,
}: {
  code: string;
  name: string;
  description?: string;
  score?: number | null;
  href?: string;
  meta?: ReactNode;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex h-full flex-col gap-4 rounded-xl border bg-surface p-5 transition-[border-color,background-color] duration-micro",
        href && "hover:border-primary/40 hover:bg-surface-hover",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
          <SkillIcon code={code} className="size-[18px]" />
        </span>
        {meta}
      </div>
      <div className="grid gap-1">
        <h3 className="text-h4">{name}</h3>
        {description && <p className="line-clamp-2 text-body-sm text-fg-secondary">{description}</p>}
      </div>
      {score !== undefined && score !== null && <Meter label="Skill score" value={score} className="mt-auto" />}
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
      {body}
    </Link>
  );
}

// ---- ScoreCard ------------------------------------------------------------------------------

export function formatScore(score: number, scale: string): string {
  return scale === "ielts_band" ? score.toFixed(1) : `${Math.round(score)}`;
}

/** Headline score. IELTS bands are always labelled as estimates. */
export function ScoreCard({
  label,
  score,
  scale,
  caption,
  size = "default",
  className,
}: {
  label: string;
  score: number | null;
  scale: "ielts_band" | "percent";
  caption?: string;
  size?: "default" | "hero";
  className?: string;
}) {
  const max = scale === "ielts_band" ? 9 : 100;
  return (
    <div className={cn("grid gap-2 rounded-xl border bg-surface p-5", className)}>
      <p className="text-label text-fg-secondary">{label}</p>
      <p className={cn("tabular-nums", size === "hero" ? "text-display" : "text-h1")}>
        {score === null ? "—" : formatScore(score, scale)}
        <span className="ml-1 text-body text-fg-muted">/ {max}</span>
      </p>
      {caption && <p className="text-caption text-fg-muted">{caption}</p>}
    </div>
  );
}

// ---- AIInsight ------------------------------------------------------------------------------

/**
 * AI coach insight. One of the few places using glass + a subtle liquid field, because it
 * represents live AI reasoning about the learner.
 */
export function AIInsight({
  title = "AI Coach",
  children,
  action,
  className,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative isolate overflow-hidden rounded-xl border", className)} aria-label={title}>
      <LiquidBackground intensity="subtle" />
      <div className="glass relative grid gap-4 rounded-xl border-0 p-5 sm:p-6">
        <p className="flex items-center gap-2 text-label text-primary-subtle-foreground">
          <Sparkles className="size-4" aria-hidden />
          {title}
        </p>
        <div className="grid gap-2 text-body text-foreground">{children}</div>
        {action && <div>{action}</div>}
      </div>
    </section>
  );
}

// ---- MistakeCard ------------------------------------------------------------------------------

export function MistakeCard({
  original,
  correction,
  category,
  explanation,
  occurrences,
  severity,
  action,
}: {
  original: string;
  correction: string;
  category: string;
  explanation?: string;
  occurrences?: number;
  severity?: "low" | "medium" | "high";
  action?: ReactNode;
}) {
  return (
    <article className="grid gap-3 rounded-xl border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{formatCategory(category)}</Badge>
        {severity && <Badge variant={severityTone(severity)}>{severity}</Badge>}
        {occurrences !== undefined && occurrences > 1 && (
          <span className="ml-auto text-caption text-fg-muted">Repeated {occurrences} times</span>
        )}
      </div>
      <p className="flex items-start gap-2 text-body text-fg-secondary">
        <X className="mt-1 size-4 shrink-0 text-error" aria-label="Incorrect" />
        <span className="line-through decoration-error/50">{original}</span>
      </p>
      <p className="flex items-start gap-2 text-body font-medium">
        <Check className="mt-1 size-4 shrink-0 text-success" aria-label="Correct" />
        <span>{correction}</span>
      </p>
      {explanation && <p className="text-body-sm text-fg-muted">{explanation}</p>}
      {action && <div className="pt-1">{action}</div>}
    </article>
  );
}

// ---- VocabularyCard ------------------------------------------------------------------------------

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

export function VocabularyCard({ card, reviewEnabled = false }: { card: VocabularyCardData; reviewEnabled?: boolean }) {
  const reviewHint = "Spaced-repetition reviews arrive with the vocabulary release.";
  return (
    <article className="grid gap-4 rounded-xl border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="text-h3">{card.term}</h3>
          <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
            {card.pronunciation_ipa && <span className="font-mono">{card.pronunciation_ipa}</span>}
            {card.part_of_speech && <span>{card.part_of_speech}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {card.level && <Badge variant="outline">{card.level}</Badge>}
          <IconButton label={`Pronounce ${card.term}`} size="icon-sm" onClick={() => speak(card.term)}>
            <Volume2 />
          </IconButton>
        </div>
      </div>
      <p className="text-body">{card.definition}</p>
      {card.examples[0] && (
        <blockquote className="border-l-2 border-primary/40 pl-3 text-body-sm text-fg-secondary italic">
          &ldquo;{card.examples[0]}&rdquo;
        </blockquote>
      )}
      <Meter label="Mastery" value={card.mastery} />
      <div className="flex gap-2">
        {(["I know it", "Review"] as const).map((label, i) =>
          reviewEnabled ? (
            <Button key={label} variant={i === 0 ? "outline" : "default"} size="sm" className="flex-1">
              {label}
            </Button>
          ) : (
            <Tooltip key={label} content={reviewHint}>
              <span className="flex-1" tabIndex={0}>
                <Button variant={i === 0 ? "outline" : "default"} size="sm" className="w-full" disabled>
                  {label}
                </Button>
              </span>
            </Tooltip>
          ),
        )}
      </div>
    </article>
  );
}

// ---- RecommendationCard ------------------------------------------------------------------------------

export function RecommendationCard({
  title,
  skill,
  reason,
  minutes,
  href,
}: {
  title: string;
  skill: string | null;
  reason?: string;
  minutes?: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col gap-3 rounded-xl border bg-surface p-5 outline-none transition-[border-color,background-color] duration-micro hover:border-primary/40 hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <div className="flex items-center gap-2 text-label text-fg-secondary">
        {skill && <SkillIcon code={skill} className="size-4 text-primary" />}
        <span className="capitalize">{skill ?? "Practice"}</span>
        {minutes && <span className="ml-auto text-fg-muted tabular-nums">{minutes} min</span>}
      </div>
      <p className="text-h4">{title}</p>
      {reason && <p className="text-body-sm text-fg-muted">{reason}</p>}
      <span className="mt-auto flex items-center gap-1 text-label text-primary">
        Start <ArrowRight className="size-4 transition-transform duration-micro group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
