"use client";

import type { LearningPlanItem } from "@engora/types";
import { ArrowRight, Clock, Compass, Flame } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { SectionTitle } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { AIInsight, RecommendationCard } from "@/components/learning/cards";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter, ProgressRing } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { contentHref, skillHref } from "@/config/navigation";
import { useAssessmentHistory, useCreateAssessment } from "@/features/assessment/hooks";
import { useHistory, useLearningPlan, useMistakeSummary, useProgress, useRecommendations } from "@/features/learner/hooks";
import { baseLevel, skillName } from "@/features/onboarding/labels";
import { useProfile } from "@/features/profile/hooks";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/api/errors";
import { formatCategory, humanize, timeAgo } from "@/lib/learning-format";

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const coreSkills = ["speaking", "writing", "reading", "listening"];
const placementLevels = ["A1", "A2", "B1", "B2", "C1"];
const FIRST_SESSION_KEY = "engora-first-session-started";

function planItemHref(item: LearningPlanItem): string {
  return item.content ? contentHref(item.content.skill ?? item.skill, item.content.id) : skillHref(item.skill);
}

function markFirstSession() {
  try {
    if (localStorage.getItem(FIRST_SESSION_KEY)) return;
    localStorage.setItem(FIRST_SESSION_KEY, "1");
  } catch {
    return;
  }
  track("first_learning_session_started");
}

/**
 * "What should I do today?" Everything here comes from the API (plan, estimated level,
 * practice time, progress, weaknesses, assessments); the mobile app renders the same state.
 */
export function DashboardView() {
  const router = useRouter();
  const profile = useProfile();
  const progress = useProgress();
  const plan = useLearningPlan();
  const recommendations = useRecommendations();
  const mistakes = useMistakeSummary();
  const history = useHistory(1);
  const assessments = useAssessmentHistory();
  const createAssessment = useCreateAssessment();

  const p = profile.data;
  const overview = progress.data;
  const level = overview?.current_estimated_level ?? p?.current_level ?? null;
  const goal = overview?.daily_goal_minutes ?? p?.daily_goal_minutes ?? 15;
  const today = overview?.today_minutes ?? 0;
  const items = plan.data?.items ?? [];
  const next = items.find((i) => i.status !== "completed") ?? items[0];
  const firstRec = recommendations.data?.[0];
  const continueHref = next ? planItemHref(next) : firstRec?.content ? contentHref(firstRec.content.skill, firstRec.content.id) : "/app/learn";
  const strongest = [...(overview?.skills ?? [])].filter((s) => s.sessions > 0 || s.estimated_level).sort((a, b) => b.score - a.score)[0];
  const focus = mistakes.data?.weaknesses[0];
  const latestAssessment = assessments.data?.find((a) => a.status === "completed");
  const openAssessment = assessments.data?.find((a) => a.status === "in_progress" || a.status === "processing");

  const startPlacement = () => {
    const base = level ? baseLevel(level) : "B1";
    createAssessment.mutate(placementLevels.includes(base) ? base : "B1", {
      onSuccess: (assessment) => router.push(`/placement-test/${assessment.id}`),
      onError: (error) => toast({ title: "Couldn't start the placement test", description: errorMessage(error), variant: "error" }),
    });
  };

  return (
    <div className="grid gap-10">
      {/* Greeting, level, streak */}
      <section className="grid gap-3">
        {profile.isPending ? (
          <Skeleton className="h-9 w-72" />
        ) : (
          <h1 className="text-h1">
            {greeting()}
            {p?.first_name || p?.display_name ? `, ${p.first_name || p.display_name}` : ""}
          </h1>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {level && (
            <Badge variant="secondary" title="Estimated level">
              {level} English
            </Badge>
          )}
          {overview && overview.streak.current_days > 0 && (
            <Badge variant="warning">
              <Flame aria-hidden /> {overview.streak.current_days} day streak
            </Badge>
          )}
          {level && <span className="text-body-sm text-fg-muted">Estimated level</span>}
        </div>
      </section>

      {/* Daily goal + continue */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex items-center gap-5 rounded-xl border bg-surface p-5">
          <ProgressRing value={Math.min(100, (today / Math.max(goal, 1)) * 100)} size={76} label="Today's goal progress">
            <Clock className="size-5 text-fg-muted" aria-hidden />
          </ProgressRing>
          <div className="grid gap-1">
            <p className="text-label text-fg-muted">Today&apos;s goal</p>
            {progress.isPending ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <p className="text-h2 tabular-nums">
                {today} / {goal} min
              </p>
            )}
            <p className="text-caption text-fg-muted">Practice time today</p>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-4 rounded-xl border bg-surface p-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
              <SkillIcon code={next?.skill ?? firstRec?.content?.skill ?? "speaking"} className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label text-fg-muted">{next ? `Continue learning · ${skillName(next.skill)}` : "Continue learning"}</p>
              {plan.isPending ? (
                <Skeleton className="mt-1 h-6 w-48" />
              ) : (
                <p className="truncate text-h4">{next?.title ?? firstRec?.content?.title ?? "Choose a skill to practise"}</p>
              )}
            </div>
          </div>
          <Button asChild size="lg">
            <Link href={continueHref} onClick={markFirstSession}>
              Continue learning <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      {/* Today's plan */}
      <section aria-labelledby="plan-title">
        <SectionTitle id="plan-title" title="Today's plan" />
        {plan.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : plan.isError ? (
          <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No plan yet"
            description="Take the placement test and Engora will build a plan around your level."
            action={
              <Button onClick={startPlacement} loading={createAssessment.isPending}>
                Find my level
              </Button>
            }
          />
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={planItemHref(item)}
                  onClick={markFirstSession}
                  className="flex h-full items-center gap-4 rounded-xl border bg-surface p-4 transition-colors duration-micro outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                    <SkillIcon code={item.skill} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-label text-fg-muted">
                      {skillName(item.skill)}
                      {item.reason_code === "weakness" && <Badge variant="outline">Focus area</Badge>}
                    </span>
                    <span className="block text-h4">{item.title}</span>
                  </span>
                  <span className="shrink-0 text-label tabular-nums text-fg-secondary">{item.minutes} min</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
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
          <EmptyState
            title="No recommendations yet"
            description="Complete a practice session and your next steps will appear here."
            action={
              <Button asChild variant="outline">
                <Link href="/app/learn">Browse skills</Link>
              </Button>
            }
          />
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
              : overview?.skills
                  .filter((s) => coreSkills.includes(s.code))
                  .map((s) => (
                    <Link key={s.code} href={skillHref(s.code)} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                      <Meter
                        label={s.name}
                        value={s.score}
                        display={
                          s.sessions === 0 && !s.estimated_level
                            ? "Not started"
                            : `${Math.round(s.score)}%${s.estimated_level ? ` · ${s.estimated_level}` : ""}`
                        }
                      />
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
                    Your strongest skill is <span className="font-medium">{strongest.name}</span> ({Math.round(strongest.score)}%).
                  </p>
                )}
                {focus && (
                  <p className="text-fg-secondary">
                    Focus next: <span className="font-medium text-foreground">{formatCategory(focus.category)}</span>
                  </p>
                )}
                <p className="text-caption text-fg-muted">Based on your assessment and recent activity</p>
              </>
            ) : (
              <p className="text-fg-secondary">Complete your first practice and your coach will suggest what to focus on.</p>
            )}
          </AIInsight>
        </section>
      </div>

      {/* Assessments */}
      <section aria-labelledby="assessments-title" id="assessments">
        <SectionTitle id="assessments-title" title="Level assessments" />
        <div className="flex flex-col gap-4 rounded-xl border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
              <Compass className="size-5" aria-hidden />
            </span>
            <div className="grid gap-0.5">
              {assessments.isPending ? (
                <Skeleton className="h-6 w-56" />
              ) : latestAssessment ? (
                <>
                  <p className="text-h4">Latest estimate: {latestAssessment.overall_cefr}</p>
                  <p className="text-body-sm text-fg-muted">
                    {latestAssessment.completed_at ? timeAgo(latestAssessment.completed_at) : ""} · {assessments.data?.length ?? 0} in history
                  </p>
                </>
              ) : (
                <>
                  <p className="text-h4">Find your estimated level</p>
                  <p className="text-body-sm text-fg-muted">A four-skill placement test personalises your plan.</p>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {latestAssessment && (
              <Button variant="outline" asChild>
                <Link href={`/assessment-results/${latestAssessment.id}`}>View results</Link>
              </Button>
            )}
            {openAssessment ? (
              <Button asChild>
                <Link href={`/placement-test/${openAssessment.id}`}>Continue test</Link>
              </Button>
            ) : (
              <Button onClick={startPlacement} loading={createAssessment.isPending}>
                {latestAssessment ? "Retake placement test" : "Take the placement test"}
              </Button>
            )}
          </div>
        </div>
      </section>

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
                  <p className="text-caption text-fg-muted capitalize">
                    {item.kind}
                    {item.mode === "placement" ? " · placement" : ""}
                  </p>
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
