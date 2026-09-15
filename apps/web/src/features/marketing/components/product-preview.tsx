"use client";

import { ArrowRight, Flame, Mic, Sparkles } from "lucide-react";

import { Meter, ProgressRing } from "@/components/ui/data-display";

import { useI18n } from "../i18n";

/**
 * A simplified rendering of the real dashboard, built from the same design-system
 * components the app uses. Values are illustrative and the preview is marked as such.
 */
export function ProductPreview() {
  const { t } = useI18n();
  const p = t.preview;

  return (
    <figure className="relative isolate">
      {/* Slowly drifting green ambient light behind the panel. Radial gradients fade to
          transparent without a clipping box, so no hard edges appear. */}
      <div aria-hidden className="pointer-events-none absolute -inset-10 -z-10">
        <div className="absolute top-[10%] left-[15%] h-3/4 w-3/4 animate-liquid rounded-full bg-[radial-gradient(closest-side,var(--liquid-1),transparent)] blur-3xl motion-reduce:animate-none" />
        <div className="absolute right-[5%] bottom-[5%] h-1/2 w-1/2 animate-liquid-slow rounded-full bg-[radial-gradient(closest-side,var(--liquid-2),transparent)] blur-3xl motion-reduce:animate-none" />
      </div>
      <div role="img" aria-label={p.ariaLabel} className="glass-panel relative grid gap-3 rounded-2xl p-4 sm:gap-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <p className="text-h4">{p.greeting}</p>
            <p className="text-body-sm text-fg-muted">{p.plan}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-(--glass-border) bg-surface/40 px-2 py-1 text-caption font-medium">{p.level}</span>
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-caption font-medium text-primary-subtle-foreground">
              <Flame className="size-3.5" aria-hidden /> {p.streak}
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-1 xl:grid-cols-2">
          <div className="glass-card flex items-center gap-4 rounded-xl p-4 sm:p-5">
            <ProgressRing value={71} size={60} stroke={5} label={p.goalProgress}>
              71%
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-label text-fg-muted">{p.goal}</p>
              <p className="mt-1 text-h3 whitespace-nowrap tabular-nums">
                32 / 45 <span className="text-body-sm font-normal text-fg-muted">{p.minutes}</span>
              </p>
            </div>
          </div>
          <div className="glass-card flex flex-col justify-between gap-3 rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                <Mic className="size-4" aria-hidden />
              </span>
              <p className="text-label text-fg-muted">
                {p.continue} · {t.skillNames.speaking}
              </p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
              <p className="min-w-36 flex-1 text-h4 leading-snug text-balance">{p.continueTitle}</p>
              <span className="btn-liquid ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-caption font-semibold text-primary-foreground">
                {p.start} <ArrowRight className="size-3.5" aria-hidden />
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-1 xl:grid-cols-2">
          <div className="glass-card grid gap-3 rounded-xl p-4 sm:p-5">
            <p className="text-label text-fg-muted">{p.progress}</p>
            <Meter label={t.skillNames.speaking} value={72} glow />
            <Meter label={t.skillNames.writing} value={64} glow />
            <Meter label={t.skillNames.reading} value={81} glow />
            <Meter label={t.skillNames.listening} value={67} glow />
          </div>
          <div className="glass-card relative grid content-start gap-2.5 overflow-hidden rounded-xl border-primary/20 p-4 sm:p-5">
            <span aria-hidden className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-[radial-gradient(closest-side,var(--primary-glow),transparent)] opacity-60 blur-2xl" />
            <p className="relative flex items-center gap-2 text-label text-primary">
              <Sparkles className="size-4" aria-hidden /> AI Coach
            </p>
            <p className="relative text-body-sm">{p.coachInsight}</p>
            <p className="relative text-body-sm text-fg-secondary">
              {p.focusNext} <span className="font-medium text-foreground">{p.focusTopic}</span>
            </p>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">{p.caption}</figcaption>
    </figure>
  );
}
