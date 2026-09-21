"use client";

import { ArrowRight, Clock, GraduationCap, Info, Mic, PenLine, Timer } from "lucide-react";
import Link from "next/link";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { LiquidBackground } from "@/components/common/liquid-background";
import { ScoreCard } from "@/components/learning/cards";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlay";
import { useContentList } from "@/features/learning/hooks";
import { useIELTSAttempts, useIELTSExams, useStartIELTSExam } from "@/features/practice/hooks";
import { ieltsDisclaimer } from "@/features/marketing/content";
import { EntitlementGate } from "@/features/subscription/components/subscription-views";

const modules = ["Speaking", "Writing", "Reading", "Listening"];

function IELTSUpgrade() {
  return (
    <div className="relative isolate overflow-hidden rounded-xl border">
      <LiquidBackground intensity="subtle" />
      <div className="glass relative grid gap-4 rounded-xl border-0 p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
        <div className="grid gap-1.5">
          <p className="flex items-center gap-2 text-label text-primary-subtle-foreground">
            <GraduationCap className="size-4" aria-hidden /> IELTS Pro
          </p>
          <p className="text-h3">Unlock IELTS mode and mock exams</p>
          <p className="text-body-sm text-fg-secondary">Exam-style tasks, band estimates per criterion and a focused exam mode.</p>
        </div>
        <Button asChild size="lg">
          <Link href="/app/subscription">
            See plans <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function IELTSView() {
  const speaking = useContentList({ exam: "ielts", type: "speaking_topic" });
  const writing = useContentList({ exam: "ielts", type: "writing_task" });
  const speakingId = speaking.data?.items[0]?.id;
  const writingId = writing.data?.items[0]?.id;

  // Bands come from the learner's own sittings. Until they have sat one there is nothing to
  // show, which is why the cards read "complete a practice" rather than zero.
  const attempts = useIELTSAttempts();
  const exams = useIELTSExams();
  const startExam = useStartIELTSExam();
  const latest = attempts.data?.find((attempt) => attempt.status === "completed");
  const open = attempts.data?.find((attempt) => attempt.status === "in_progress");
  const exam = exams.data?.[0];
  const bandOf = (skill: "listening" | "reading" | "writing" | "speaking") =>
    latest?.sections[skill]?.band ?? null;

  return (
    <>
      <PageHeader title="IELTS Preparation" description="Exam-style practice on the same engine you use every day." />

      <section aria-labelledby="bands-title">
        <SectionTitle id="bands-title" title="Estimated bands" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <ScoreCard
            label="Overall"
            score={latest?.overall_band ?? null}
            scale="ielts_band"
            size="hero"
            caption={
              latest
                ? `Estimated from your mock exam on ${new Date(latest.completed_at ?? latest.started_at).toLocaleDateString()}.`
                : "Complete an IELTS practice to get your first estimate."
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {modules.map((m) => (
              <ScoreCard
                key={m}
                label={m}
                score={bandOf(m.toLowerCase() as "listening" | "reading" | "writing" | "speaking")}
                scale="ielts_band"
              />
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="continue-title" className="mt-10">
        <SectionTitle id="continue-title" title="Continue preparation" />
        <EntitlementGate feature="ielts.mode" fallback={<IELTSUpgrade />}>
          <div className="grid gap-4 md:grid-cols-3">
            <ModeCard icon={Mic} title="Speaking Test" text="Part 2 cue card with preparation time." meta="2 min" href={speakingId ? `/app/speaking?content=${speakingId}` : undefined} />
            <ModeCard icon={PenLine} title="Writing Task 2" text="Timed essay in focused exam mode." meta="40 min" href={writingId ? `/app/ielts/exam?content=${writingId}` : undefined} />
            <MockExamCard
              exam={exam}
              openAttempt={open}
              starting={startExam.isPending}
              onStart={() => exam && startExam.mutate(exam.slug)}
            />
          </div>
        </EntitlementGate>
      </section>

      <p className="mt-10 flex items-start gap-2 text-caption text-fg-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {ieltsDisclaimer}
      </p>
    </>
  );
}

/**
 * The full mock exam.
 *
 * It only offers itself when an exam is actually published, and when the learner already has
 * a sitting open it continues that one instead of starting a second: a mock exam is one
 * continuous effort, and the API enforces the same rule.
 */
function MockExamCard({
  exam,
  openAttempt,
  starting,
  onStart,
}: {
  exam?: { slug: string; title: string; total_minutes: number };
  openAttempt?: { id: string };
  starting: boolean;
  onStart: () => void;
}) {
  const cls = "grid content-start gap-3 rounded-xl border bg-surface p-5";

  if (!exam) {
    return (
      <Tooltip content="No mock exam has been published yet.">
        <div tabIndex={0} className={`${cls} opacity-60`}>
          <div className="flex items-center justify-between">
            <span className="grid size-10 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
              <Timer className="size-5" aria-hidden />
            </span>
          </div>
          <p className="text-h4">Full Mock Exam</p>
          <p className="text-body-sm text-fg-secondary">All four modules under real timing.</p>
        </div>
      </Tooltip>
    );
  }

  return (
    <div className={cls}>
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
          <Timer className="size-5" aria-hidden />
        </span>
        <span className="flex items-center gap-1 text-caption text-fg-muted">
          <Clock className="size-3.5" aria-hidden /> {Math.floor(exam.total_minutes / 60)} h {exam.total_minutes % 60} min
        </span>
      </div>
      <p className="text-h4">{exam.title}</p>
      <p className="text-body-sm text-fg-secondary">All four modules under real timing, scored section by section.</p>
      <Button size="sm" className="w-fit" loading={starting} onClick={onStart}>
        {openAttempt ? "Continue exam" : "Start mock exam"} <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}

function ModeCard({ icon: Icon, title, text, meta, href }: { icon: typeof Mic; title: string; text: string; meta: string; href?: string }) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="flex items-center gap-1 text-caption text-fg-muted">
          <Clock className="size-3.5" aria-hidden /> {meta}
        </span>
      </div>
      <p className="text-h4">{title}</p>
      <p className="text-body-sm text-fg-secondary">{text}</p>
    </>
  );
  const cls = "grid content-start gap-3 rounded-xl border bg-surface p-5";
  if (!href) {
    return (
      <Tooltip content="Available in a later release.">
        <div tabIndex={0} className={`${cls} opacity-60`}>
          {inner}
        </div>
      </Tooltip>
    );
  }
  return (
    <Link href={href} className={`${cls} outline-none transition-colors duration-micro hover:border-primary/40 hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40`}>
      {inner}
    </Link>
  );
}
