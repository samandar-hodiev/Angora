"use client";

import type { AssessmentArea } from "@engora/types";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { EmptyState, ErrorState } from "@/components/common/states";
import { AIInsight } from "@/components/learning/cards";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useLearningPlan } from "@/features/learner/hooks";
import { PlanItems } from "@/features/onboarding/components/plan-items";
import { useCompleteOnboarding, useOnboarding, useRegeneratePlan, useResultsViewed } from "@/features/onboarding/hooks";
import { areaLabel, baseLevel, levelLabels, skillName } from "@/features/onboarding/labels";
import { track } from "@/lib/analytics";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { useAssessmentResult } from "../hooks";

export function ResultsView({ id }: { id: string }) {
  const router = useRouter();
  const result = useAssessmentResult(id);
  const onboarding = useOnboarding();
  const plan = useLearningPlan();
  const complete = useCompleteOnboarding();
  const regenerate = useRegeneratePlan();
  const { mutate: markViewed } = useResultsViewed();

  const state = onboarding.data;
  const inOnboarding = state?.assessment_id === id && state.step !== "COMPLETED";
  const loaded = Boolean(result.data);
  const step = state?.step;
  const onboardingAssessment = state?.assessment_id;

  useEffect(() => {
    if (loaded) track("assessment_result_viewed", { assessment_id: id });
  }, [loaded, id]);

  useEffect(() => {
    if (step === "PLACEMENT_RESULTS" && onboardingAssessment === id) markViewed();
  }, [step, onboardingAssessment, id, markViewed]);

  if (result.isPending) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (result.isError) {
    if (isApiError(result.error) && result.error.status === 404) {
      return (
        <EmptyState
          title="Your results aren't ready yet"
          description="Finish the test, or wait a moment while your answers are analysed."
          action={
            <Button asChild>
              <Link href={`/placement-test/${id}`}>Back to the test</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;
  }

  const r = result.data;
  const level = levelLabels[baseLevel(r.overall.cefr)];
  const planForThis = plan.data && plan.data.source_assessment_id === id ? plan.data : null;

  const startLearning = () => {
    if (!inOnboarding) {
      router.push("/app/dashboard");
      return;
    }
    complete.mutate(undefined, {
      onSuccess: () => router.replace("/app/dashboard"),
      onError: (error) => toast({ title: "Couldn't continue", description: errorMessage(error), variant: "error" }),
    });
  };

  return (
    <div className="grid gap-8">
      <header className="journey-card grid justify-items-center gap-2 rounded-3xl px-5 py-10 text-center sm:px-10">
        <p className="text-label text-primary">Placement assessment</p>
        <h1 className="text-h2">Your estimated English level</h1>
        <p className="mt-3 text-[clamp(4.5rem,14vw,7rem)] leading-none font-semibold tracking-tight text-primary">{r.overall.cefr}</p>
        {level && <p className="text-h4">{level.name}</p>}
        <p className="mt-2 max-w-md text-body-sm text-balance text-fg-secondary">
          Estimated from your performance across four skills. It&apos;s a personal estimate to guide your learning, not an official certificate.
        </p>
      </header>

      <section aria-labelledby="skills-title" className="grid gap-4">
        <h2 id="skills-title" className="text-h3">
          Four skills
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {r.skills.map((s) => (
            <li key={s.skill} className="journey-card grid gap-3 rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-h4">
                  <SkillIcon code={s.skill} className="size-4 text-primary" />
                  {skillName(s.skill)}
                </span>
                <span className="text-label tabular-nums">
                  {Math.round(s.score)}% · {s.cefr}
                </span>
              </div>
              <Progress value={s.score} aria-label={`${skillName(s.skill)}: ${Math.round(s.score)}%, estimated ${s.cefr}`} className="h-1.5" />
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <AreaList title="Your strengths" areas={r.strengths} empty="Strengths will stand out as your skills develop." tone="strength" />
        <AreaList title="Your focus areas" areas={r.focus_areas} empty="Your skills are well balanced." tone="focus" />
      </div>

      <AIInsight>
        <p>{r.summary.text}</p>
      </AIInsight>

      <section aria-labelledby="plan-title" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="plan-title" className="text-h3">
            Your personalized plan
          </h2>
          <p className="text-body-sm text-fg-secondary">Based on your assessment, Engora recommends:</p>
        </div>
        <PlanItems
          plan={planForThis}
          isPending={plan.isPending}
          error={plan.error}
          onRetry={inOnboarding ? () => regenerate.mutate() : undefined}
          retrying={regenerate.isPending}
        />
      </section>

      <div className="flex justify-center">
        <Button variant="liquid" size="lg" onClick={startLearning} loading={complete.isPending}>
          Start learning {!complete.isPending && <ArrowRight aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

function AreaList({ title, areas, empty, tone }: { title: string; areas: AssessmentArea[]; empty: string; tone: "strength" | "focus" }) {
  return (
    <section className="journey-card grid content-start gap-3 rounded-2xl p-5">
      <h2 className="text-h4">{title}</h2>
      {areas.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {areas.map((area) => {
            const label = areaLabel(area);
            return (
              <li
                key={`${area.type}:${area.code}`}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-body-sm",
                  tone === "strength" ? "border-primary/40 bg-primary-subtle/40" : "border-warning/40 bg-warning/10",
                )}
              >
                <span className="font-medium">{label.title}</span>
                {label.context && <span className="text-fg-muted"> {label.context}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
