"use client";

import type { OnboardingState } from "@engora/types";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  GraduationCap,
  MessageCircle,
  Mic,
  Plane,
  Route,
  School,
  Sparkles,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { OptionCard } from "@/components/ui/choice";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/errors";

import { useNavigateOnboarding, useOnboarding, useSetDailyTime, useSetGoals, useStartOnboarding } from "../hooks";
import { dailyTimeLabels, goalLabels } from "../labels";

import { ChoiceCard, ChoiceGroup, OnboardingProgress, StepCard, StepHeader } from "./step-parts";

const TOTAL_STEPS = 4;

const onError = (error: unknown) => toast({ title: "Couldn't save that", description: errorMessage(error), variant: "error" });

/** Product onboarding: welcome, goals and daily time. The level comes next, on /level. */
export function OnboardingFlow() {
  const { data: state } = useOnboarding();
  if (!state) return null;
  switch (state.step) {
    case "NOT_STARTED":
    case "WELCOME":
      return <WelcomeStep />;
    case "GOAL_SELECTION":
      return <GoalsStep state={state} />;
    case "DAILY_TIME":
      return <DailyTimeStep state={state} />;
    default:
      return null;
  }
}

const welcomePoints: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Mic, title: "Practice English", text: "Speak, write, read and listen with real tasks." },
  { icon: Sparkles, title: "Get AI feedback", text: "Clear notes on grammar, vocabulary and fluency." },
  { icon: Target, title: "Find weaknesses", text: "See the patterns that hold you back." },
  { icon: Route, title: "Follow a personalized plan", text: "Short daily sessions built around your goals." },
];

function WelcomeStep() {
  const start = useStartOnboarding();
  return (
    <StepCard
      footer={
        <>
          <span />
          <Button variant="liquid" size="lg" onClick={() => start.mutate(undefined, { onError })} loading={start.isPending}>
            Continue {!start.isPending && <ArrowRight aria-hidden />}
          </Button>
        </>
      }
    >
      <OnboardingProgress current={1} total={TOTAL_STEPS} />
      <StepHeader title="Welcome to Engora" description="Your personal AI English coach." />
      <ul className="grid gap-3 sm:grid-cols-2">
        {welcomePoints.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-xl border bg-surface/40 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <span className="grid gap-0.5">
              <span className="text-h4">{title}</span>
              <span className="text-body-sm text-fg-secondary">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </StepCard>
  );
}

const goalIcons: Record<string, LucideIcon> = {
  improve_english: TrendingUp,
  speak_confidently: MessageCircle,
  ielts: GraduationCap,
  work: Briefcase,
  university: School,
  travel: Plane,
};

function GoalsStep({ state }: { state: OnboardingState }) {
  const setGoals = useSetGoals();
  const [selected, setSelected] = useState<string[]>(() => state.goals.filter((g) => state.options.goals.includes(g)));

  const toggle = (code: string) =>
    setSelected((current) =>
      current.includes(code) ? current.filter((g) => g !== code) : current.length < state.options.max_goals ? [...current, code] : current,
    );

  return (
    <StepCard
      footer={
        <>
          <span className="text-body-sm text-fg-muted" aria-live="polite">
            {selected.length === 0 ? "Choose at least one" : `${selected.length} selected`}
          </span>
          <Button
            variant="liquid"
            size="lg"
            disabled={selected.length === 0}
            loading={setGoals.isPending}
            onClick={() => setGoals.mutate(selected, { onError })}
          >
            Continue {!setGoals.isPending && <ArrowRight aria-hidden />}
          </Button>
        </>
      }
    >
      <OnboardingProgress current={2} total={TOTAL_STEPS} />
      <StepHeader title="What are you learning English for?" description="Choose one or more. You can change this later." />
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Learning goals">
        {state.options.goals.map((code) => {
          const Icon = goalIcons[code] ?? Sparkles;
          const label = goalLabels[code];
          return (
            <OptionCard key={code} selected={selected.includes(code)} onClick={() => toggle(code)} className="rounded-xl bg-surface/50 py-4">
              <Icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="grid gap-0.5">
                <span>{label?.label ?? code}</span>
                {label && <span className="text-caption font-normal text-fg-muted">{label.description}</span>}
              </span>
            </OptionCard>
          );
        })}
      </div>
    </StepCard>
  );
}

function DailyTimeStep({ state }: { state: OnboardingState }) {
  const setDailyTime = useSetDailyTime();
  const navigate = useNavigateOnboarding();
  const [minutes, setMinutes] = useState<string | null>(() =>
    state.options.daily_minutes.includes(state.daily_goal_minutes) ? String(state.daily_goal_minutes) : null,
  );

  return (
    <StepCard
      footer={
        <>
          <Button variant="ghost" onClick={() => navigate.mutate("GOAL_SELECTION", { onError })} disabled={navigate.isPending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          <Button
            variant="liquid"
            size="lg"
            disabled={minutes === null}
            loading={setDailyTime.isPending}
            onClick={() => minutes && setDailyTime.mutate(Number(minutes), { onError })}
          >
            Continue {!setDailyTime.isPending && <ArrowRight aria-hidden />}
          </Button>
        </>
      }
    >
      <OnboardingProgress current={3} total={TOTAL_STEPS} />
      <StepHeader title="How much time can you learn each day?" description="Small, regular sessions work best." />
      <ChoiceGroup value={minutes} onValueChange={setMinutes} label="Daily learning time" className="sm:grid-cols-2">
        {state.options.daily_minutes.map((m) => (
          <ChoiceCard key={m} value={String(m)}>
            <span className="text-h3 tabular-nums">{m} min</span>
            <span className="text-body-sm text-fg-muted">{dailyTimeLabels[m]}</span>
          </ChoiceCard>
        ))}
      </ChoiceGroup>
    </StepCard>
  );
}
