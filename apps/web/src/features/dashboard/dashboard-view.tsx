"use client";

import { ArrowRight, Clock, Flame, Sparkles } from "lucide-react";
import Link from "next/link";

import { SectionTitle } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { AIInsight, RecommendationCard } from "@/components/learning/cards";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter, ProgressRing } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { contentHref, skillHref } from "@/config/navigation";
import { useHistory, useMistakeSummary, useProgress, useRecommendations } from "@/features/learner/hooks";
import { useProfile } from "@/features/profile/hooks";
import { formatCategory, humanize, timeAgo } from "@/lib/learning-format";

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const coreSkills = ["speaking", "writing", "reading", "listening"];

/**
 * "What should I do today?" The dashboard composes API resources only; the mobile app
 * renders the same state from the same endpoints.
 */
export function DashboardView() {
  const profile = useProfile();
  const progress = useProgress();
  const recommendations = useRecommendations();
  const mistakes = useMistakeSummary();
  const history = useHistory(1);

  const p = profile.data;
  const firstRec = recommendations.data?.[0];
  const continueHref = firstRec?.content ? contentHref(firstRec.content.skill, firstRec.content.id) : "/app/learn";
  const strongest = [...(progress.data?.skills ?? [])].filter((s) => s.sessions > 0).sort((a, b) => b.score - a.score)[0];
  const focus = mistakes.data?.weaknesses[0];

  return (
    <div className="grid gap-10">
      {/* Greeting, level, streak */}
      <section className="grid gap-3">
        {profile.isPending ? (
          <Skeleton className="h-9 w-72" />
        ) : (
          <h1 className="text-h1">
            {greeting()}
            {p?.display_name ? `, ${p.display_name}` : ""}
          </h1>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {p?.current_level ? <Badge variant="secondary">{p.current_level} English</Badge> : null}
          {progress.data && progress.data.streak.current_days > 0 && (
            <Badge variant="warning">
              <Flame aria-hidden /> {progress.data.streak.current_days} day streak
            </Badge>
          )}
          {p?.target_level && <span className="text-body-sm text-fg-muted">Target {p.target_level}</span>}
        </div>
      </section>

      {p && !p.onboarding_completed_at && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-subtle p-5 sm:flex-row sm:items-center">
          <Sparkles className="size-5 text-primary" aria-hidden />
          <div className="flex-1">
            <p className="text-h4 text-primary-subtle-foreground">Finish setting up your plan</p>
            <p className="text-body-sm text-fg-secondary">Four quick questions so Engora can personalise your practice.</p>
          </div>
          <Button asChild>
            <Link href="/onboarding">Continue setup</Link>
          </Button>
        </div>
      )}

      {/* Daily goal + continue */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex items-center gap-5 rounded-xl border bg-surface p-5">
          <ProgressRing value={0} size={76} label="Today's goal progress">
            <Clock className="size-5 text-fg-muted" aria-hidden />
          </ProgressRing>
          <div className="grid gap-1">
            <p className="text-label text-fg-muted">Today&apos;s goal</p>
            {profile.isPending ? <Skeleton className="h-7 w-28" /> : <p className="text-h2 tabular-nums">0 / {p?.daily_goal_minutes ?? 15} min</p>}
            <p className="text-caption text-fg-muted">Time is tracked once you complete practice sessions.</p>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-4 rounded-xl border bg-surface p-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
              <SkillIcon code={firstRec?.content?.skill ?? "speaking"} className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label text-fg-muted">Continue learning</p>
              {recommendations.isPending ? (
                <Skeleton className="mt-1 h-6 w-48" />
              ) : (
                <p className="truncate text-h4">{firstRec?.content?.title ?? "Choose a skill to practise"}</p>
              )}
            </div>
          </div>
          <Button asChild size="lg">
            <Link href={continueHref}>
              Continue learning <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      {/* Recommended */}
      <section aria-labelledby="rec-title">
        <SectionTitle id="rec-title" title="Recommended for you" />
        {recommendations.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : recommendations.isError ? (
          <ErrorState error={recommendations.error} onRetry={() => void recommendations.refetch()} />
        ) : recommendations.data.length === 0 ? (
          <EmptyState title="No recommendations yet" description="Complete a practice session and your next steps will appear here." action={<Button asChild variant="outline"><Link href="/app/learn">Browse skills</Link></Button>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.data.slice(0, 3).map((rec) => (
              <RecommendationCard
                key={rec.id}
                title={rec.content?.title ?? humanize(rec.type)}
                skill={rec.content?.skill ?? null}
                reason={rec.reason}
                href={rec.content ? contentHref(rec.content.skill, rec.content.id) : "/app/learn"}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Skill progress */}
        <section aria-labelledby="skills-title">
          <SectionTitle
            id="skills-title"
            title="Your progress"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/app/progress">
                  Details <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          />
          <div className="grid gap-4 rounded-xl border bg-surface p-5">
            {progress.isPending
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)
              : progress.data?.skills
                  .filter((s) => coreSkills.includes(s.code))
                  .map((s) => (
                    <Link key={s.code} href={skillHref(s.code)} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                      <Meter label={s.name} value={s.score} display={s.sessions === 0 ? "Not started" : `${Math.round(s.score)}%`} />
                    </Link>
                  ))}
          </div>
        </section>

        {/* Weak areas + AI coach */}
        <section aria-labelledby="weak-title" className="grid content-start gap-4">
          <SectionTitle
            id="weak-title"
            title="Weak areas"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/app/mistakes">
                  All mistakes <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          />
          {mistakes.isPending ? (
            <Skeleton className="h-28 rounded-xl" />
          ) : mistakes.data && mistakes.data.weaknesses.length > 0 ? (
            <div className="grid gap-3 rounded-xl border bg-surface p-5">
              {mistakes.data.weaknesses.slice(0, 3).map((w) => (
                <Meter key={w.category} label={formatCategory(w.category)} value={w.severity_score} tone="warning" display={`${w.evidence_count} times`} />
              ))}
            </div>
          ) : (
            <EmptyState title="No weak areas detected yet" description="Patterns appear after a few practice sessions." className="py-8" />
          )}

          <AIInsight
            action={
              focus ? (
                <Button asChild size="sm">
                  <Link href={focus.category.startsWith("grammar") ? "/app/grammar" : "/app/mistakes"}>Practice now</Link>
                </Button>
              ) : undefined
            }
          >
            {strongest || focus ? (
              <>
                {strongest && (
                  <p>
                    Your strongest skill is <span className="font-medium">{strongest.name}</span> ({Math.round(strongest.score)}).
                  </p>
                )}
                {focus && (
                  <p className="text-fg-secondary">
                    Focus next: <span className="font-medium text-foreground">{formatCategory(focus.category)}</span>
                  </p>
                )}
                <p className="text-caption text-fg-muted">Based on your recent activity</p>
              </>
            ) : (
              <p className="text-fg-secondary">Complete your first practice and your coach will suggest what to focus on.</p>
            )}
          </AIInsight>
        </section>
      </div>

      {/* Recent activity */}
      <section aria-labelledby="activity-title">
        <SectionTitle
          id="activity-title"
          title="Recent activity"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/app/history">
                History <ArrowRight aria-hidden />
              </Link>
            </Button>
          }
        />
        {history.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : !history.data || history.data.items.length === 0 ? (
          <EmptyState title="No activity yet" description="Your sessions, submissions and attempts will be listed here." className="py-8" />
        ) : (
          <ul className="divide-y rounded-xl border bg-surface">
            {history.data.items.slice(0, 5).map((item) => (
              <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                <SkillIcon code={item.kind} className="size-4 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-medium">{item.title}</p>
                  <p className="text-caption text-fg-muted capitalize">{item.kind}</p>
                </div>
                {item.score !== null && <span className="text-label tabular-nums">{item.score <= 9 ? item.score.toFixed(1) : `${Math.round(item.score)}%`}</span>}
                <span className="w-16 text-right text-caption text-fg-muted">{timeAgo(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
