"use client";

import type { AssessmentSkill, OnboardingState } from "@engora/types";
import { ArrowLeft, ArrowRight, Compass, Info } from "lucide-react";
import { useState } from "react";

import { SkillIcon } from "@/components/learning/skill-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useAssessmentConfig } from "@/features/assessment/hooks";
import { useLearningPlan } from "@/features/learner/hooks";
import { errorMessage } from "@/lib/api/errors";

import {
  useChooseLevel,
  useChoosePlacement,
  useCompleteOnboarding,
  useNavigateOnboarding,
  useOnboarding,
  useRegeneratePlan,
  useStartPlacement,
} from "../hooks";
import { levelLabels, skillName } from "../labels";

import { PlanItems } from "./plan-items";
import { ChoiceCard, ChoiceGroup, LevelCardContent, OnboardingProgress, StepCard, StepHeader } from "./step-parts";

const onError = (error: unknown) => toast({ title: "Something went wrong", description: errorMessage(error), variant: "error" });

/** Level selection — separate from onboarding: "How good is your English?" */
export function LevelFlow() {
  const { data: state } = useOnboarding();
  if (!state) return null;
  switch (state.step) {
    case "LEVEL_SELECTION":
      return <LevelChoice state={state} />;
    case "PLACEMENT_INTRO":
      return <PlacementIntro />;
    case "PLACEMENT_START_LEVEL":
      return <StartLevel state={state} />;
    case "PERSONALIZED_PLAN":
      return <SelfReportedPlan state={state} />;
    default:
      return null;
  }
}

function LevelOptions({ state, value, onChange, label }: { state: OnboardingState; value: string | null; onChange: (v: string) => void; label: string }) {
  return (
    <ChoiceGroup value={value} onValueChange={onChange} label={label}>
      {state.options.levels.map((code) => (
        <ChoiceCard key={code} value={code}>
          <LevelCardContent code={code} name={levelLabels[code]?.name ?? code} description={levelLabels[code]?.description ?? ""} />
        </ChoiceCard>
      ))}
    </ChoiceGroup>
  );
}

function LevelChoice({ state }: { state: OnboardingState }) {
  const [level, setLevel] = useState<string | null>(state.self_reported_level);
  const choose = useChooseLevel();
  const placement = useChoosePlacement();
  const navigate = useNavigateOnboarding();

  return (
    <StepCard
      footer={
        <>
          <Button variant="ghost" onClick={() => navigate.mutate("DAILY_TIME", { onError })} disabled={navigate.isPending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          <Button variant="liquid" size="lg" disabled={!level} loading={choose.isPending} onClick={() => level && choose.mutate(level, { onError })}>
            Continue {!choose.isPending && <ArrowRight aria-hidden />}
          </Button>
        </>
      }
    >
      <OnboardingProgress current={4} total={4} />
      <StepHeader title="What's your English level?" description="Choose the level that best describes your current English." />
      <LevelOptions state={state} value={level} onChange={setLevel} label="English level" />
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-surface/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-0.5">
          <p className="text-h4">Not sure about your level?</p>
          <p className="text-body-sm text-fg-secondary">Take a short four-skill test and get an estimated level.</p>
        </div>
        <Button variant="outline" onClick={() => placement.mutate(undefined, { onError })} loading={placement.isPending}>
          <Compass aria-hidden /> Find my level
        </Button>
      </div>
    </StepCard>
  );
}

const skillOrder: AssessmentSkill[] = ["reading", "listening", "writing", "speaking"];

function PlacementIntro() {
  const navigate = useNavigateOnboarding();
  const config = useAssessmentConfig();
  const sections = config.data?.sections ?? [];
  const totalMinutes = Math.round(sections.reduce((sum, s) => sum + s.time_limit_seconds, 0) / 60);

  const describe = (skill: AssessmentSkill) => {
    const section = sections.find((s) => s.skill === skill);
    switch (skill) {
      case "reading":
        return "Short texts with comprehension and vocabulary questions.";
      case "listening":
        return `Recordings you can play up to ${section?.max_plays ?? 2} times.`;
      case "writing":
        return "One writing task. Spell-check and hints are turned off.";
      case "speaking":
        return "Short spoken answers using your microphone.";
    }
  };

  return (
    <StepCard
      footer={
        <>
          <Button variant="ghost" onClick={() => navigate.mutate("LEVEL_SELECTION", { onError })} disabled={navigate.isPending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          <Button variant="liquid" size="lg" loading={navigate.isPending} onClick={() => navigate.mutate("PLACEMENT_START_LEVEL", { onError })}>
            Continue {!navigate.isPending && <ArrowRight aria-hidden />}
          </Button>
        </>
      }
    >
      <StepHeader title="Let's find your English level" description="We'll check your Reading, Listening, Writing and Speaking skills." />
      <ol className="grid gap-2.5">
        {skillOrder.map((skill, i) => {
          const section = sections.find((s) => s.skill === skill);
          return (
            <li key={skill} className="flex items-center gap-4 rounded-xl border bg-surface/40 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                <SkillIcon code={skill} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-h4">
                  {i + 1}. {skillName(skill)}
                </p>
                <p className="text-body-sm text-fg-secondary">{describe(skill)}</p>
              </div>
              {config.isPending ? (
                <Skeleton className="h-6 w-14" />
              ) : (
                section && <span className="shrink-0 text-label tabular-nums text-fg-secondary">{Math.round(section.time_limit_seconds / 60)} min</span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="grid gap-2 rounded-xl bg-surface/40 p-4 text-body-sm text-fg-secondary">
        {totalMinutes > 0 && <p>About {totalMinutes} minutes in total. Sections unlock one at a time, each with its own timer.</p>}
        <p>Your progress is saved, so you can continue later if you need to stop.</p>
        <p className="flex items-start gap-2 text-caption text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          You&apos;ll get an estimated CEFR level to personalise your learning — not an official certificate.
        </p>
      </div>
    </StepCard>
  );
}

function StartLevel({ state }: { state: OnboardingState }) {
  const [level, setLevel] = useState<string | null>(state.placement_start_level ?? state.self_reported_level);
  const start = useStartPlacement();
  const navigate = useNavigateOnboarding();

  return (
    <StepCard
      footer={
        <>
          <Button variant="ghost" onClick={() => navigate.mutate("PLACEMENT_INTRO", { onError })} disabled={navigate.isPending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          <Button variant="liquid" size="lg" disabled={!level} loading={start.isPending} onClick={() => level && start.mutate(level, { onError })}>
            Start the test {!start.isPending && <ArrowRight aria-hidden />}
          </Button>
        </>
      }
    >
      <StepHeader title="What level do you think you're closest to?" description="This is only a starting point. The test also checks the levels around it." />
      <LevelOptions state={state} value={level} onChange={setLevel} label="Closest level" />
    </StepCard>
  );
}

function SelfReportedPlan({ state }: { state: OnboardingState }) {
  const plan = useLearningPlan();
  const complete = useCompleteOnboarding();
  const regenerate = useRegeneratePlan();
  const navigate = useNavigateOnboarding();

  return (
    <StepCard
      footer={
        <>
          <Button variant="ghost" onClick={() => navigate.mutate("LEVEL_SELECTION", { onError })} disabled={navigate.isPending}>
            <ArrowLeft aria-hidden /> Change level
          </Button>
          <Button
            variant="liquid"
            size="lg"
            disabled={!plan.data}
            loading={complete.isPending}
            onClick={() => complete.mutate(undefined, { onError })}
          >
            Start learning {!complete.isPending && <ArrowRight aria-hidden />}
          </Button>
        </>
      }
    >
      <StepHeader
        title="Your personalized plan"
        description={`Based on your ${state.self_reported_level ?? ""} level and goals, Engora recommends:`}
      />
      <PlanItems
        plan={plan.data}
        isPending={plan.isPending}
        error={plan.error}
        onRetry={() => regenerate.mutate(undefined, { onError })}
        retrying={regenerate.isPending}
      />
      <p className="text-body-sm text-fg-muted">Not sure the level is right? You can take the placement test any time from your dashboard.</p>
    </StepCard>
  );
}
