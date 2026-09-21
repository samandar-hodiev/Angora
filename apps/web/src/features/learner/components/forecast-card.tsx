"use client";

import { CalendarClock, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCategory } from "@/lib/learning-format";

import { useForecast } from "../hooks";

/**
 * When you reach the next level, at the rate you are going.
 *
 * This is arithmetic, not a promise and not an AI guess: a straight line is fitted to your
 * weekly practice scores and extended to the score that marks the next level. The card says
 * so, and shows the weeks it was fitted to, because a date whose reasoning is hidden is
 * just a number to distrust.
 *
 * It refuses more often than it answers, and that is the design. Four weeks of practice, a
 * flat trend, or a trend going the wrong way all produce no date — an encouraging date that
 * turns out to be wrong costs more trust than no date ever does.
 */

const reasons: Record<string, { title: string; body: string }> = {
  not_enough_practice: {
    title: "Not enough practice yet",
    body: "A few weeks of regular practice and this will show when you are likely to reach the next level.",
  },
  no_upward_trend: {
    title: "Your scores are holding steady",
    body: "There is no upward trend to project from yet. Try practising the skill with the lowest score below.",
  },
  too_far_out: {
    title: "Too far out to say",
    body: "At the current rate the next level is more than a year away, and a lot changes in a year. More practice each week will bring it closer.",
  },
};

export function ForecastCard() {
  const forecast = useForecast();

  if (forecast.isPending) return <Skeleton className="h-44 rounded-xl" />;
  // A forecast is a nice-to-have. If it fails, the rest of Progress carries on without it.
  if (forecast.isError || !forecast.data) return null;

  const f = forecast.data;
  const peak = Math.max(...f.weeks.map((w) => w.avg_score), 1);
  const falling = f.trend_per_week < 0;

  const weakest = [...f.skills].sort((a, b) => a.avg_score - b.avg_score)[0];
  const strongest = [...f.skills].sort((a, b) => b.trend_per_week - a.trend_per_week)[0];

  return (
    <div className="grid gap-5 rounded-xl border bg-surface p-5">
      {f.available && f.reason === "ready_now" ? (
        <div className="grid gap-1">
          <p className="text-h4">You are scoring at the next level already</p>
          <p className="text-body-sm text-fg-secondary">
            Take the placement test again — your level is likely to move to {f.next_level ?? "the next band"}.
          </p>
        </div>
      ) : f.available && f.projected_date ? (
        <div className="grid gap-1">
          <p className="flex items-center gap-2 text-label text-fg-muted">
            <CalendarClock className="size-4" aria-hidden />
            At your current rate
          </p>
          <p className="text-h3">
            {f.next_level ?? "Next level"} by{" "}
            {new Date(f.projected_date).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
          <p className="text-body-sm text-fg-secondary">
            About {Math.round(f.weeks_to_next_level ?? 0)} weeks away, from {f.sessions} sessions over{" "}
            {f.weeks.length} weeks.
          </p>
        </div>
      ) : (
        <div className="grid gap-1">
          <p className="text-h4">{reasons[f.reason ?? "not_enough_practice"]?.title ?? "No projection yet"}</p>
          <p className="text-body-sm text-fg-secondary">
            {reasons[f.reason ?? "not_enough_practice"]?.body ?? ""}
          </p>
        </div>
      )}

      {f.weeks.length > 1 && (
        <div className="grid gap-2">
          <div className="flex h-16 items-end gap-1" role="img" aria-label="Weekly average score">
            {f.weeks.map((week) => (
              <div
                key={week.week_start}
                title={`${new Date(week.week_start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${Math.round(week.avg_score)}`}
                className="flex-1 rounded-t-sm bg-primary/60"
                style={{ height: `${Math.max(6, (week.avg_score / peak) * 100)}%` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
            <span className="inline-flex items-center gap-1">
              {falling ? (
                <TrendingDown className="size-3.5 text-error" aria-hidden />
              ) : (
                <TrendingUp className="size-3.5 text-success" aria-hidden />
              )}
              {falling ? "" : "+"}
              {f.trend_per_week.toFixed(1)} points a week
            </span>
            <span>·</span>
            <span>{f.weekly_sessions.toFixed(1)} sessions a week</span>
            {f.confidence > 0 && (
              <>
                <span>·</span>
                <span>fit {Math.round(f.confidence * 100)}%</span>
              </>
            )}
          </div>
        </div>
      )}

      {f.skills.length > 1 && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {strongest && strongest.trend_per_week > 0 && (
            <Badge variant="outline" className="gap-1">
              <TrendingUp className="size-3.5 text-success" aria-hidden />
              {formatCategory(strongest.skill)} improving fastest
            </Badge>
          )}
          {weakest && (
            <Badge variant="outline" className="gap-1">
              {formatCategory(weakest.skill)} lowest at {Math.round(weakest.avg_score)}
            </Badge>
          )}
        </div>
      )}

      <p className="text-caption text-fg-muted">
        A straight line fitted to your weekly scores — not a promise, and not a guess by an AI.
      </p>
    </div>
  );
}
