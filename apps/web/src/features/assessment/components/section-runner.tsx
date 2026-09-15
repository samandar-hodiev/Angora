"use client";

import type { Assessment, AssessmentSection, SectionContent } from "@engora/types";
import { ArrowRight, CheckCircle2, CircleAlert, Loader2, Lock } from "lucide-react";

import { ErrorState } from "@/components/common/states";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { skillName } from "@/features/onboarding/labels";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { useSectionContent, useStartSection, useSubmitSection } from "../hooks";

import { ObjectiveSection } from "./objective-section";
import { SpeakingSection } from "./speaking-section";
import { WritingSection } from "./writing-section";

export interface SectionProps {
  assessment: Assessment;
  content: SectionContent;
  /** Client time when `content` arrived, to correct the countdown for clock skew. */
  receivedAt: number;
  onSubmit: () => void;
  submitting: boolean;
}

export function SectionRunner({ assessment, section }: { assessment: Assessment; section: AssessmentSection }) {
  const content = useSectionContent(assessment.id, section.skill);
  const submit = useSubmitSection(assessment.id);

  const onSubmit = () => {
    if (submit.isPending) return;
    submit.mutate(section.skill, {
      onError: (error) => toast({ title: "Couldn't submit this section", description: errorMessage(error), variant: "error" }),
    });
  };

  if (content.isPending) {
    return (
      <div className="grid gap-5 py-6">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  if (content.isError) {
    return <ErrorState error={content.error} onRetry={() => void content.refetch()} className="my-10" />;
  }

  const props: SectionProps = { assessment, content: content.data, receivedAt: content.dataUpdatedAt, onSubmit, submitting: submit.isPending };
  switch (section.skill) {
    case "reading":
    case "listening":
      return <ObjectiveSection {...props} />;
    case "writing":
      return <WritingSection {...props} />;
    case "speaking":
      return <SpeakingSection {...props} />;
  }
}

function sectionTips(section: AssessmentSection): string[] {
  const minutes = Math.round(section.time_limit_seconds / 60);
  switch (section.skill) {
    case "reading":
      return [`${minutes} minutes for ${section.item_count} questions.`, "Read each text, then choose the best answer.", "You can move between questions before you finish."];
    case "listening":
      return [`${minutes} minutes for ${section.item_count} questions.`, `You can play each recording up to ${section.max_plays ?? 2} times.`, "Use headphones if you can."];
    case "writing":
      return [`${minutes} minutes for one writing task.`, "Spell-check, suggestions and hints are turned off.", "Your draft is saved as you type."];
    case "speaking":
      return [
        `${minutes} minutes for ${section.item_count} short tasks.`,
        `You can record each answer up to ${section.max_attempts ?? 2} times.`,
        "Find a quiet place and allow microphone access when asked.",
      ];
  }
}

const statusView: Record<AssessmentSection["status"], { label: string; icon: React.ReactNode; tone: string }> = {
  completed: { label: "Completed", icon: <CheckCircle2 className="size-4" aria-hidden />, tone: "text-primary" },
  evaluating: { label: "Analysing", icon: <Loader2 className="size-4 animate-spin" aria-hidden />, tone: "text-fg-secondary" },
  failed: { label: "Needs retry", icon: <CircleAlert className="size-4" aria-hidden />, tone: "text-error" },
  in_progress: { label: "In progress", icon: <ArrowRight className="size-4" aria-hidden />, tone: "text-primary" },
  available: { label: "Up next", icon: <ArrowRight className="size-4" aria-hidden />, tone: "text-primary" },
  locked: { label: "Locked", icon: <Lock className="size-4" aria-hidden />, tone: "text-fg-muted" },
};

/** Section overview between sections: sequential unlocking and what comes next. */
export function SectionHub({ assessment }: { assessment: Assessment }) {
  const start = useStartSection(assessment.id);
  const next = assessment.sections.find((s) => s.status === "available");
  const done = assessment.sections.filter((s) => s.status === "completed" || s.status === "evaluating").length;

  return (
    <div className="mx-auto grid max-w-2xl gap-6 py-6 sm:py-10">
      <div className="grid gap-2">
        <p className="text-label text-primary">Placement assessment</p>
        <h1 className="text-h1 text-balance">{done === 0 ? "Let's begin" : "Nice work — keep going"}</h1>
        <p className="text-body-lg text-fg-secondary">Complete the four sections in order. Each section has its own timer.</p>
      </div>

      <ol className="journey-card divide-y rounded-2xl">
        {assessment.sections.map((s) => {
          const view = statusView[s.status];
          return (
            <li key={s.skill} className={cn("flex items-center gap-4 px-4 py-4 sm:px-5", s.status === "locked" && "opacity-70")}>
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                <SkillIcon code={s.skill} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-h4">{skillName(s.skill)}</p>
                <p className="text-body-sm text-fg-muted">
                  {Math.round(s.time_limit_seconds / 60)} min · {s.item_count}{" "}
                  {s.skill === "writing" ? "task" : s.skill === "speaking" ? "tasks" : "questions"}
                </p>
              </div>
              <span className={cn("flex shrink-0 items-center gap-1.5 text-label", view.tone)}>
                {view.icon}
                {view.label}
              </span>
            </li>
          );
        })}
      </ol>

      {next && (
        <div className="grid gap-4 rounded-2xl border bg-surface/40 p-5">
          <p className="text-h4">Before you start {skillName(next.skill).toLowerCase()}</p>
          <ul className="grid gap-1.5 text-body-sm text-fg-secondary">
            {sectionTips(next).map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                {tip}
              </li>
            ))}
          </ul>
          <Button
            variant="liquid"
            size="lg"
            className="justify-self-start"
            loading={start.isPending}
            onClick={() =>
              start.mutate(next.skill, {
                onError: (error) => toast({ title: "Couldn't start the section", description: errorMessage(error), variant: "error" }),
              })
            }
          >
            Start {skillName(next.skill).toLowerCase()} {!start.isPending && <ArrowRight aria-hidden />}
          </Button>
        </div>
      )}
    </div>
  );
}
