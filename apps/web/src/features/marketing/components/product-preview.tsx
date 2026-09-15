import { ArrowRight, Flame, Mic, Sparkles } from "lucide-react";

import { LiquidBackground } from "@/components/common/liquid-background";
import { Badge } from "@/components/ui/badge";
import { Meter, ProgressRing } from "@/components/ui/data-display";

/**
 * A simplified rendering of the real dashboard, built from the same design-system
 * components the app uses. Values are illustrative and the preview is marked as such.
 */
export function ProductPreview() {
  return (
    <figure className="relative isolate">
      <LiquidBackground className="-inset-10 rounded-[2rem]" />
      <div
        role="img"
        aria-label="Preview of the Engora dashboard with a daily goal, a recommended speaking task and skill progress"
        className="relative grid gap-4 rounded-2xl border bg-surface/90 p-4 shadow-lg backdrop-blur-sm sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-h4">Good morning</p>
            <p className="text-body-sm text-fg-muted">Here&apos;s your plan for today</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">B1 English</Badge>
            <Badge variant="warning">
              <Flame aria-hidden /> 12 day streak
            </Badge>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-4 rounded-xl border bg-surface p-4">
            <ProgressRing value={71} size={64} label="Daily goal progress">
              71%
            </ProgressRing>
            <div>
              <p className="text-label text-fg-muted">Today&apos;s goal</p>
              <p className="text-h3 tabular-nums">32 / 45 min</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-xl border bg-surface p-4">
            <span className="grid size-10 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
              <Mic className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-label text-fg-muted">Continue learning · Speaking</p>
              <p className="truncate text-h4">Talk about your hometown</p>
            </div>
            <span className="hidden items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-label text-primary-foreground sm:inline-flex">
              Start <ArrowRight className="size-3.5" aria-hidden />
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-3 rounded-xl border bg-surface p-4">
            <p className="text-label text-fg-muted">Your progress</p>
            <Meter label="Speaking" value={72} />
            <Meter label="Writing" value={64} />
            <Meter label="Reading" value={81} />
            <Meter label="Listening" value={67} />
          </div>
          <div className="glass grid content-start gap-2 rounded-xl p-4">
            <p className="flex items-center gap-2 text-label text-primary-subtle-foreground">
              <Sparkles className="size-4" aria-hidden /> AI Coach
            </p>
            <p className="text-body-sm">Your answers are getting longer and more fluent.</p>
            <p className="text-body-sm text-fg-secondary">
              Focus next: <span className="font-medium text-foreground">Past Simple</span>
            </p>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">Illustrative preview of the product</figcaption>
    </figure>
  );
}
