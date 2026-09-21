"use client";

import { ArrowRight, Award, Flame, GraduationCap, Layers } from "lucide-react";
import Link from "next/link";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter, ProgressRing, Stat } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { skillHref } from "@/config/navigation";
import { useGrammarProgress } from "@/features/grammar/hooks";
import { formatCategory, timeAgo } from "@/lib/learning-format";

import { useMistakeSummary, useProgress } from "../hooks";
import { ForecastCard } from "./forecast-card";

export function ProgressView() {
  const progress = useProgress();
  const mistakes = useMistakeSummary();
  const grammar = useGrammarProgress();

  if (progress.isPending) {
    return (
      <>
        <PageHeader title="Your Progress" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </>
    );
  }
  if (progress.isError) return <ErrorState error={progress.error} onRetry={() => void progress.refetch()} />;

  const p = progress.data;
  const sessions = p.skills.reduce((sum, s) => sum + s.sessions, 0);
  const xp = p.skills.reduce((sum, s) => sum + s.xp, 0);

  return (
    <>
      <PageHeader
        title="Your Progress"
        description="Skill scores, streaks and focus areas — the same on every device."
        actions={
          <Button variant="outline" asChild>
            <Link href="/app/history">
              Practice history <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-4 rounded-lg border bg-surface p-4">
          <ProgressRing value={p.overall_score ?? 0} size={60} label="Overall score">
            {p.overall_score === null ? "—" : Math.round(p.overall_score)}
          </ProgressRing>
          <div>
            <p className="text-label text-fg-muted">Overall</p>
            <p className="text-h2">{p.current_level ?? "—"}</p>
            {p.target_level && <p className="text-caption text-fg-muted">Target {p.target_level}</p>}
          </div>
        </div>
        <Stat label="Streak" value={`${p.streak.current_days} days`} icon={Flame} hint={`Longest: ${p.streak.longest_days} days`} />
        <Stat label="Sessions" value={sessions} icon={Layers} />
        <Stat label="Experience" value={xp.toLocaleString()} icon={Award} hint="XP across all skills" />
      </section>

      <section aria-labelledby="skills-title" className="mt-10">
        <SectionTitle id="skills-title" title="Skills" />
        {sessions === 0 ? (
          <EmptyState icon={GraduationCap} title="No practice yet" description="Your skill scores start after your first session." action={<Button asChild><Link href="/app/learn">Start practising</Link></Button>} />
        ) : (
          <ul className="divide-y rounded-xl border bg-surface">
            {p.skills.map((s) => (
              <li key={s.code}>
                <Link href={skillHref(s.code)} className="grid gap-3 px-5 py-4 transition-colors duration-micro hover:bg-surface-hover sm:grid-cols-[12rem_minmax(0,1fr)_10rem] sm:items-center sm:gap-6">
                  <span className="flex items-center gap-3">
                    <SkillIcon code={s.code} className="size-4 text-primary" />
                    <span className="text-h4">{s.name}</span>
                    {s.estimated_level && <Badge variant="outline">{s.estimated_level}</Badge>}
                  </span>
                  <Meter label={`${s.sessions} sessions`} value={s.score} display={s.sessions === 0 ? "—" : String(Math.round(s.score))} />
                  <span className="text-caption text-fg-muted sm:text-right">{s.last_practiced_at ? `Practised ${timeAgo(s.last_practiced_at)}` : "Not practised"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="forecast-title" className="mt-10">
        <SectionTitle id="forecast-title" title="What's next" />
        <ForecastCard />
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="weak-title">
          <SectionTitle id="weak-title" title="Weaknesses" />
          {mistakes.data && mistakes.data.weaknesses.length > 0 ? (
            <div className="grid gap-4 rounded-xl border bg-surface p-5">
              {mistakes.data.weaknesses.map((w) => (
                <Meter key={w.category} label={formatCategory(w.category)} value={w.severity_score} tone={w.status === "improving" ? "primary" : "warning"} display={w.status} />
              ))}
            </div>
          ) : (
            <EmptyState title="No weaknesses detected" className="py-8" />
          )}
        </section>
        <section aria-labelledby="grammar-title">
          <SectionTitle
            id="grammar-title"
            title="Grammar"
            action={
              grammar.data ? (
                <Link href="/app/grammar" className="text-label text-fg-muted hover:text-foreground">
                  Overall {Math.round(grammar.data.overall)}% <ArrowRight className="inline size-3.5" aria-hidden />
                </Link>
              ) : undefined
            }
          />
          {grammar.isPending ? (
            <Skeleton className="h-44 rounded-xl" />
          ) : grammar.isError || !grammar.data ? (
            // Grammar failing must not take the rest of Progress down.
            <EmptyState title="Grammar progress is unavailable" className="py-8" />
          ) : grammar.data.stats.topics_started === 0 ? (
            <EmptyState
              title="You haven't practised any grammar yet"
              description="Open a topic and practise it — your mastery will appear here."
              className="py-8"
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link href="/app/grammar">Browse grammar</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 rounded-xl border bg-surface p-5">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-fg-secondary">
                <span>
                  <span className="font-medium text-foreground">{grammar.data.stats.topics_started}</span> started
                </span>
                <span>
                  <span className="font-medium text-foreground">{grammar.data.stats.topics_mastered}</span> mastered
                </span>
                <span>
                  <span className="font-medium text-foreground">{grammar.data.stats.topics_total}</span> topics in total
                </span>
              </div>
              <ul className="grid gap-3">
                {grammar.data.categories
                  .filter((c) => c.started > 0)
                  .slice(0, 6)
                  .map((c) => (
                    <li key={c.slug}>
                      <Meter
                        label={c.name}
                        value={c.mastery}
                        display={`${Math.round(c.mastery)}%`}
                        tone={c.mastery >= 80 ? "success" : c.mastery < 50 ? "warning" : "primary"}
                      />
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
