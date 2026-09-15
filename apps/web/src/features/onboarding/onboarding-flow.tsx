"use client";

import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  CircleHelp,
  GraduationCap,
  MessageCircle,
  Plane,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/common/brand";
import { ErrorState } from "@/components/common/states";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OptionCard } from "@/components/ui/choice";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useLevels, useSkills } from "@/features/learning/hooks";
import { useUpdateProfile } from "@/features/profile/hooks";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import {
  canContinue,
  dailyTimeOptions,
  goalLabel,
  goalOptions,
  initialAnswers,
  ONBOARDING_STEPS,
  recommendedToday,
  toggleSkill,
  toProfileUpdate,
  UNSURE_LEVEL,
  type OnboardingAnswers,
} from "./model";

const goalIcons: Record<string, LucideIcon> = {
  improve_english: TrendingUp,
  ielts: GraduationCap,
  speak_confidently: MessageCircle,
  career: Briefcase,
  university: Building2,
  travel: Plane,
  business: Briefcase,
};

const questionSteps = ONBOARDING_STEPS.length - 1;

export function OnboardingFlow() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(initialAnswers);
  const skills = useSkills();
  const levels = useLevels();
  const updateProfile = useUpdateProfile();

  const step = ONBOARDING_STEPS[stepIndex]!;
  const isPlan = step === "plan";

  const next = async () => {
    if (step === "time") {
      try {
        await updateProfile.mutateAsync(toProfileUpdate(answers));
      } catch (error) {
        toast({ title: "Couldn't save your answers", description: errorMessage(error), variant: "error" });
        return;
      }
    }
    setStepIndex((i) => Math.min(i + 1, ONBOARDING_STEPS.length - 1));
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 pt-6 sm:px-6">
        <Brand href="/" />
        {!isPlan && (
          <span className="text-label text-fg-muted tabular-nums">
            Step {stepIndex + 1} of {questionSteps}
          </span>
        )}
      </header>

      {!isPlan && (
        <div
          className="mx-auto mt-5 h-1 w-full max-w-2xl overflow-hidden rounded-full bg-surface-active px-0 sm:w-[calc(100%-3rem)]"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={0}
          aria-valuemax={questionSteps}
          aria-valuenow={stepIndex + 1}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-emphasis ease-emphasized" style={{ width: `${((stepIndex + 1) / questionSteps) * 100}%` }} />
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div key={step} className="animate-in fade-in-0 slide-in-from-bottom-2 duration-normal">
          {step === "goal" && (
            <Question title="What do you want to achieve?" description="We'll shape your practice around it.">
              <div className="grid gap-3 sm:grid-cols-2">
                {goalOptions.map((goal) => {
                  const Icon = goalIcons[goal.code] ?? Sparkles;
                  return (
                    <OptionCard key={goal.code} selected={answers.goal === goal.code} onClick={() => setAnswers((a) => ({ ...a, goal: goal.code }))}>
                      <Icon className="size-5 text-primary" aria-hidden />
                      {goal.label}
                    </OptionCard>
                  );
                })}
              </div>
            </Question>
          )}

          {step === "level" && (
            <Question title="What's your current level?" description="Choose the closest match. You can change it any time.">
              {levels.isPending ? (
                <OptionSkeletons count={6} />
              ) : levels.isError ? (
                <ErrorState error={levels.error} onRetry={() => void levels.refetch()} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {levels.data.map((level) => (
                    <OptionCard key={level.id} selected={answers.level === level.code} onClick={() => setAnswers((a) => ({ ...a, level: level.code }))}>
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-active text-label">{level.code}</span>
                      <span className="grid gap-0.5">
                        <span>{level.name}</span>
                        <span className="text-caption font-normal text-fg-muted">{level.description}</span>
                      </span>
                    </OptionCard>
                  ))}
                  <OptionCard
                    className="sm:col-span-2"
                    selected={answers.level === UNSURE_LEVEL}
                    onClick={() => setAnswers((a) => ({ ...a, level: UNSURE_LEVEL }))}
                  >
                    <CircleHelp className="size-5 text-primary" aria-hidden />
                    <span className="grid gap-0.5">
                      <span>I&apos;m not sure</span>
                      <span className="text-caption font-normal text-fg-muted">We&apos;ll add a short placement test to your plan.</span>
                    </span>
                  </OptionCard>
                </div>
              )}
            </Question>
          )}

          {step === "skills" && (
            <Question title="What do you want to improve?" description="Choose as many as you like.">
              {skills.isPending ? (
                <OptionSkeletons count={7} />
              ) : skills.isError ? (
                <ErrorState error={skills.error} onRetry={() => void skills.refetch()} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {skills.data.map((skill) => (
                    <OptionCard
                      key={skill.id}
                      selected={answers.skills.includes(skill.code)}
                      onClick={() => setAnswers((a) => ({ ...a, skills: toggleSkill(a.skills, skill.code) }))}
                    >
                      <SkillIcon code={skill.code} className="size-5 text-primary" />
                      {skill.name}
                    </OptionCard>
                  ))}
                </div>
              )}
            </Question>
          )}

          {step === "time" && (
            <Question title="How much time can you learn each day?" description="Small, regular sessions work best.">
              <div className="grid gap-3 sm:grid-cols-2">
                {dailyTimeOptions.map((option) => (
                  <OptionCard
                    key={option.minutes}
                    selected={answers.dailyMinutes === option.minutes}
                    onClick={() => setAnswers((a) => ({ ...a, dailyMinutes: option.minutes }))}
                  >
                    <span className="text-h4 tabular-nums">{option.minutes} min</span>
                    <span className="text-body-sm font-normal text-fg-muted">{option.label}</span>
                  </OptionCard>
                ))}
              </div>
            </Question>
          )}

          {step === "plan" && (
            <PlanSummary
              answers={answers}
              levelName={levels.data?.find((l) => l.code === answers.level)?.name}
              skillNames={Object.fromEntries((skills.data ?? []).map((s) => [s.code, s.name]))}
              catalogueOrder={(skills.data ?? []).map((s) => s.code)}
              onStart={() => router.replace("/app/dashboard")}
            />
          )}
        </div>
      </main>

      {!isPlan && (
        <footer className="sticky bottom-0 border-t bg-background/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <Button variant="ghost" onClick={() => setStepIndex((i) => Math.max(i - 1, 0))} disabled={stepIndex === 0}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
            <Button onClick={() => void next()} disabled={!canContinue(step, answers)} loading={updateProfile.isPending}>
              {step === "time" ? "Build my plan" : "Continue"}
              {!updateProfile.isPending && <ArrowRight aria-hidden />}
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}

function Question({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="question" className="grid gap-8">
      <div className="grid gap-2">
        <h1 id="question" className="text-h1 text-balance">
          {title}
        </h1>
        <p className="text-body-lg text-fg-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}

function OptionSkeletons({ count }: { count: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

function PlanSummary({
  answers,
  levelName,
  skillNames,
  catalogueOrder,
  onStart,
}: {
  answers: OnboardingAnswers;
  levelName?: string;
  skillNames: Record<string, string>;
  catalogueOrder: string[];
  onStart: () => void;
}) {
  const today = recommendedToday(answers.skills, catalogueOrder);
  const unsure = answers.level === UNSURE_LEVEL;

  return (
    <section aria-labelledby="plan-title" className="grid gap-8">
      <div className="grid justify-items-start gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <h1 id="plan-title" className="text-h1">
          Your learning plan is ready
        </h1>
        <p className="text-body-lg text-fg-secondary">Built from your answers. It will adapt as you practise.</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Level", value: unsure ? "Placement test" : `${answers.level}${levelName ? ` · ${levelName}` : ""}` },
          { label: "Goal", value: goalLabel(answers.goal) },
          { label: "Daily", value: `${answers.dailyMinutes} minutes` },
        ].map((item) => (
          <div key={item.label} className="grid gap-1 rounded-xl border bg-surface p-4">
            <dt className="text-label text-fg-muted">{item.label}</dt>
            <dd className="text-h4">{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3">
        <h2 className="text-label text-fg-muted">Focus</h2>
        <div className="flex flex-wrap gap-2">
          {answers.skills.map((code) => (
            <Badge key={code} variant="secondary" className="px-2.5 py-1 text-body-sm">
              <SkillIcon code={code} className="size-3.5" />
              {skillNames[code] ?? code}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <h2 className="text-label text-fg-muted">Recommended today</h2>
        <ol className="grid gap-2">
          {today.map((code, i) => (
            <li key={code} className={cn("flex items-center gap-3 rounded-xl border bg-surface p-4")}>
              <span className="grid size-7 place-items-center rounded-full bg-surface-active text-caption tabular-nums">{i + 1}</span>
              <SkillIcon code={code} className="size-5 text-primary" />
              <span className="text-h4">{skillNames[code] ?? code}</span>
            </li>
          ))}
          {unsure && (
            <li className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-body-sm text-fg-secondary">
              <CircleHelp className="size-5 text-primary" aria-hidden />
              A short placement test will be added when it becomes available.
            </li>
          )}
        </ol>
      </div>

      <Button size="lg" onClick={onStart} className="justify-self-start">
        Start learning <ArrowRight aria-hidden />
      </Button>
    </section>
  );
}
