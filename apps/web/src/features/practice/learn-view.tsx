"use client";

import { Compass } from "lucide-react";
import Link from "next/link";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { RecommendationCard, SkillCard } from "@/components/learning/cards";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { contentHref, skillHref } from "@/config/navigation";
import { useProgress, useRecommendations } from "@/features/learner/hooks";
import { useSkills } from "@/features/learning/hooks";

export function LearnView() {
  const skills = useSkills();
  const progress = useProgress();
  const recommendations = useRecommendations();
  const scores = Object.fromEntries((progress.data?.skills ?? []).map((s) => [s.code, s]));

  return (
    <>
      <PageHeader title="Learn" description="Choose a skill, or pick up where your plan suggests." />

      {recommendations.data && recommendations.data.length > 0 && (
        <section aria-labelledby="next-title" className="mb-10">
          <SectionTitle id="next-title" title="Suggested next" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.data.slice(0, 3).map((rec) =>
              rec.content ? (
                <RecommendationCard key={rec.id} title={rec.content.title} skill={rec.content.skill} reason={rec.reason} href={contentHref(rec.content.skill, rec.content.id)} />
              ) : null,
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="skills-title">
        <SectionTitle id="skills-title" title="Skills" />
        {skills.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : skills.isError ? (
          <ErrorState title="Couldn't load skills" error={skills.error} onRetry={() => void skills.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {skills.data.map((skill) => {
              const sp = scores[skill.code];
              return (
                <SkillCard
                  key={skill.id}
                  code={skill.code}
                  name={skill.name}
                  description={skill.description}
                  score={sp && sp.sessions > 0 ? sp.score : undefined}
                  href={skillHref(skill.code)}
                  meta={sp?.estimated_level ? <span className="text-caption text-fg-muted">{sp.estimated_level}</span> : undefined}
                />
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

export function UnknownSkillView({ code }: { code: string }) {
  const skills = useSkills();
  if (skills.isPending) return <Skeleton className="h-48 rounded-xl" />;
  const skill = skills.data?.find((s) => s.code === code);
  return (
    <>
      <PageHeader title={skill?.name ?? "Skill not found"} description={skill?.description} />
      <EmptyState
        icon={Compass}
        title={skill ? "Practice for this skill is coming" : "This skill doesn't exist"}
        description={skill ? "Exercises will appear here as soon as they are published." : "It may have been renamed or removed."}
        action={
          <Button variant="outline" asChild>
            <Link href="/app/learn">Back to Learn</Link>
          </Button>
        }
      />
    </>
  );
}
