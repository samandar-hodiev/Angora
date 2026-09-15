"use client";

import type { Assessment } from "@engora/types";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/common/brand";
import { FullPageLoader } from "@/components/common/full-page-loader";
import { ErrorState } from "@/components/common/states";
import { JourneyBackdrop } from "@/components/journey/journey-shell";
import { AIProcessingState } from "@/components/learning/ai-processing";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useAbandonPlacement } from "@/features/onboarding/hooks";
import { skillName } from "@/features/onboarding/labels";
import { errorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";

import { useAbandonAssessment, useAssessment, useRetryEvaluation } from "../hooks";

import { SectionHub, SectionRunner } from "./section-runner";

/** The dedicated, distraction-free placement test environment. */
export function AssessmentRunner({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const assessment = useAssessment(id);
  const a = assessment.data;

  useEffect(() => {
    if (a?.status !== "completed") return;
    // Results were produced in the background: refresh the journey state, then open them.
    void queryClient
      .invalidateQueries({ queryKey: queryKeys.onboarding.state })
      .finally(() => router.replace(`/assessment-results/${id}`));
  }, [a?.status, id, queryClient, router]);

  let body: React.ReactNode;
  if (assessment.isPending) body = <FullPageLoader label="Loading your test" />;
  else if (assessment.isError) body = <ErrorState error={assessment.error} onRetry={() => void assessment.refetch()} className="my-16" />;
  else if (a!.status === "abandoned") body = <AbandonedState source={a!.source} />;
  else if (a!.status === "processing" || a!.status === "failed") body = <ProcessingView assessment={a!} />;
  else if (a!.status === "completed") body = <FullPageLoader label="Opening your results" />;
  else {
    const active = a!.sections.find((s) => s.status === "in_progress");
    body = active ? <SectionRunner key={active.skill} assessment={a!} section={active} /> : <SectionHub assessment={a!} />;
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <JourneyBackdrop />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 pt-4 sm:px-6">
        <p className="flex items-center gap-2 text-label">
          <BrandMark />
          Placement assessment
        </p>
        {a && <SectionSteps assessment={a} />}
        {a && a.status === "in_progress" && <ExitButton assessment={a} />}
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 sm:px-6">
        {body}
      </main>
    </div>
  );
}

function SectionSteps({ assessment }: { assessment: Assessment }) {
  const current = assessment.sections.find((s) => s.status === "in_progress" || s.status === "available");
  return (
    <ol className="hidden items-center gap-1.5 md:flex" aria-label="Sections">
      {assessment.sections.map((s) => (
        <li
          key={s.skill}
          aria-current={s === current ? "step" : undefined}
          className={cn(
            "rounded-full border px-2.5 py-1 text-caption",
            s.status === "completed" || s.status === "evaluating" ? "border-primary/40 text-primary" : "text-fg-muted",
            s === current && "border-primary bg-primary-subtle/50 text-foreground",
          )}
        >
          {skillName(s.skill)}
        </li>
      ))}
    </ol>
  );
}

function ExitButton({ assessment }: { assessment: Assessment }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const abandonOnboarding = useAbandonPlacement();
  const abandonProfile = useAbandonAssessment(assessment.id);
  const fromOnboarding = assessment.source === "onboarding";
  const leaving = abandonOnboarding.isPending || abandonProfile.isPending;

  const chooseLevel = () => {
    const onError = (error: unknown) => toast({ title: "Couldn't leave the test", description: errorMessage(error), variant: "error" });
    if (fromOnboarding) abandonOnboarding.mutate(undefined, { onSuccess: () => router.replace("/level"), onError });
    else abandonProfile.mutate(undefined, { onSuccess: () => router.replace("/app/dashboard"), onError });
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <LogOut aria-hidden /> Exit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave the test?</DialogTitle>
            <DialogDescription>
              Your answers are saved and you can continue where you left off. A section you&apos;ve already started keeps its timer running.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={chooseLevel} loading={leaving}>
              {fromOnboarding ? "Skip the test and choose my level" : "Cancel this test"}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Keep going
              </Button>
              <Button variant="liquid" asChild>
                <Link href={fromOnboarding ? "/" : "/app/dashboard"}>Save and exit</Link>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AbandonedState({ source }: { source: Assessment["source"] }) {
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-4 py-20 text-center">
      <h1 className="text-h2">This test was closed</h1>
      <p className="text-body text-fg-secondary">You can choose your level or start a new placement test whenever you like.</p>
      <Button asChild>
        <Link href={source === "onboarding" ? "/level" : "/app/dashboard"}>Continue</Link>
      </Button>
    </div>
  );
}

/**
 * After the last section. The stage labels illustrate what is assessed; writing and speaking
 * are evaluated together in the background, so they are not reported as separate live steps.
 */
function ProcessingView({ assessment }: { assessment: Assessment }) {
  const retry = useRetryEvaluation(assessment.id);
  const failed = assessment.sections.filter((s) => s.status === "failed");

  return (
    <div className="mx-auto grid max-w-xl gap-5 py-12 sm:py-20">
      {failed.length === 0 ? (
        <AIProcessingState
          title="Analyzing your responses…"
          steps={["Checking grammar", "Analyzing vocabulary", "Evaluating fluency", "Preparing your feedback"]}
          autoAdvanceMs={2400}
        />
      ) : (
        <div role="alert" className="journey-card grid gap-4 rounded-2xl p-6 sm:p-8">
          <CircleAlert className="size-7 text-error" aria-hidden />
          <h1 className="text-h3">Something went wrong while analyzing your response.</h1>
          <p className="text-body-sm text-fg-secondary">Your answers are saved, so you won&apos;t need to take the test again.</p>
          <div className="flex flex-wrap gap-2">
            {failed.map((s) => (
              <Button
                key={s.skill}
                onClick={() =>
                  retry.mutate(s.skill, {
                    onError: (error) => toast({ title: "Couldn't retry", description: errorMessage(error), variant: "error" }),
                  })
                }
                loading={retry.isPending}
              >
                Try {skillName(s.skill).toLowerCase()} analysis again
              </Button>
            ))}
          </div>
        </div>
      )}
      <p className="text-center text-caption text-fg-muted">This page updates automatically when your results are ready.</p>
    </div>
  );
}
