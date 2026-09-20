"use client";

import { ArrowLeft, ArrowRight, Check, CircleAlert, RotateCw, Target, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorState, InlineLoader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrammarAttempt, GrammarFeedback, GrammarResponse, GrammarResult } from "@engora/types";

import { useAnswerQuestion, useCompletePractice, useStartPractice } from "../hooks";
import { hasAnswer, QuestionForm } from "./question-forms";
import { StateBadge } from "./shared";

/**
 * A practice session.
 *
 * It should feel like a lesson, not an exam: one question at a time, visible progress, and
 * in learning mode an explanation the moment an answer is marked. Test mode is the same
 * screen with the feedback withheld — the server decides that, not this component, so the
 * two modes cannot drift apart.
 */
export function GrammarPracticeView({ slug }: { slug: string }) {
  const params = useSearchParams();
  const mode = params.get("mode") === "test" ? "test" : "learning";
  const rule = params.get("rule") ?? undefined;

  const start = useStartPractice(slug);
  const [attempt, setAttempt] = useState<GrammarAttempt | null>(null);
  const [result, setResult] = useState<GrammarResult | null>(null);
  const started = useRef(false);

  // One run per visit. Without the guard, React's development double-invoke would open two.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start.mutate({ mode, rule }, { onSuccess: setAttempt });
  }, [mode, rule, start]);

  if (start.isPending || (!attempt && !start.isError)) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <Skeleton className="h-6 w-40 rounded" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (start.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorState
          error={start.error}
          title="Practice could not start"
          onRetry={() => start.mutate({ mode, rule }, { onSuccess: setAttempt })}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" asChild>
            <Link href={`/app/grammar/${slug}`}>
              <ArrowLeft aria-hidden />
              Back to the topic
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (result) return <ResultView slug={slug} result={result} mode={mode} />;
  if (!attempt) return null;

  return <Session slug={slug} attempt={attempt} onComplete={setResult} />;
}

function Session({
  slug,
  attempt,
  onComplete,
}: {
  slug: string;
  attempt: GrammarAttempt;
  onComplete: (result: GrammarResult) => void;
}) {
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState<GrammarResponse>({});
  const [feedback, setFeedback] = useState<GrammarFeedback | null>(null);
  const shownAt = useRef(0);

  const answer = useAnswerQuestion(attempt.id);
  const complete = useCompletePractice(attempt.id, slug);

  const question = attempt.questions[index]!;
  const last = index === attempt.questions.length - 1;
  const canSubmit = hasAnswer(question, response);
  const marked = feedback !== null;

  // How long the learner spent on this question, started when it is shown rather than at
  // render: reading time is part of what the practice engine records.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  const submit = () => {
    if (!canSubmit || answer.isPending) return;
    answer.mutate(
      { question_id: question.id, response, response_ms: Date.now() - shownAt.current },
      { onSuccess: setFeedback },
    );
  };

  const next = () => {
    if (last) {
      complete.mutate(undefined, { onSuccess: onComplete });
      return;
    }
    setIndex((i) => i + 1);
    setResponse({});
    setFeedback(null);
  };

  return (
    <div className="mx-auto grid max-w-2xl gap-5 pb-40 md:pb-0">
      <header className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/app/grammar/${slug}`}
            className="inline-flex items-center gap-1.5 text-label text-fg-muted transition-colors duration-micro hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {attempt.topic_name}
          </Link>
          <span className="flex items-center gap-2">
            {attempt.mode === "test" && <Badge variant="secondary">Test mode</Badge>}
            <span className="text-label text-fg-muted tabular-nums">
              {index + 1} / {attempt.questions.length}
            </span>
          </span>
        </div>
        <Progress value={((index + (marked ? 1 : 0)) / attempt.questions.length) * 100} />
      </header>

      <section aria-labelledby="question-prompt" className="grid gap-4">
        <div className="grid gap-1.5">
          <h1 id="question-prompt" className="text-h3">
            {question.prompt}
          </h1>
          {question.target_rule && (
            <p className="text-caption text-fg-muted">{humanizeRule(question.target_rule)}</p>
          )}
        </div>

        <QuestionForm
          key={question.id}
          question={question}
          value={response}
          onChange={(r) => !marked && setResponse(r)}
          onSubmit={submit}
          disabled={marked || answer.isPending}
          expected={feedback?.expected}
          correct={feedback?.correct ?? null}
        />

        {answer.isPending && question.type === "free_writing" && (
          <InlineLoader label="Checking your writing…" />
        )}
        {answer.isError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-dashed px-4 py-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-body-sm text-fg-secondary">Your answer could not be saved. Try again.</p>
          </div>
        )}

        {marked && <FeedbackPanel feedback={feedback} explanation={question.explanation} />}
      </section>

      {/* Pinned on a phone so the action is always in reach without scrolling back, and
          lifted clear of the app's floating bottom navigation, which sits at bottom-3 and
          would otherwise cover it. On desktop it is an ordinary button in the flow. */}
      <div
        style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
        className="fixed inset-x-3 z-30 rounded-xl border bg-background/95 p-3 backdrop-blur-sm md:static md:inset-x-auto md:rounded-none md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          {!marked ? (
            <Button className="flex-1" disabled={!canSubmit} loading={answer.isPending} onClick={submit}>
              Check
            </Button>
          ) : (
            <Button className="flex-1" loading={complete.isPending} onClick={next}>
              {last ? "See results" : "Next question"} <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackPanel({ feedback, explanation }: { feedback: GrammarFeedback; explanation?: string }) {
  // Test mode: the answer is recorded and nothing is revealed until the run is over.
  if (feedback.correct === null) {
    return (
      <p role="status" className="rounded-xl border border-dashed px-4 py-3 text-body-sm text-fg-muted">
        Answer recorded. You&apos;ll see how you did at the end.
      </p>
    );
  }

  const correct = feedback.correct;
  return (
    <div
      role="status"
      className={cn(
        "grid gap-2 rounded-xl border-l-2 bg-surface px-4 py-3",
        correct ? "border-success" : "border-warning",
      )}
    >
      <p className="flex items-center gap-2 text-body font-medium">
        {correct ? (
          <Check className="size-4 text-success" aria-hidden />
        ) : (
          <X className="size-4 text-error" aria-hidden />
        )}
        {correct ? "Correct" : "Not quite"}
      </p>

      {feedback.ai_unavailable && (
        <p className="text-body-sm text-fg-muted">
          Your answer was saved, but it could not be checked right now.
        </p>
      )}

      {(feedback.corrections ?? []).length > 0 && (
        <ul className="grid gap-2">
          {feedback.corrections!.map((c, i) => (
            <li key={i} className="grid gap-0.5">
              <span className="flex items-center gap-2">
                <Badge variant={c.kind === "target_grammar" ? "warning" : "outline"}>{kindLabel(c.kind)}</Badge>
              </span>
              <span className="text-body-sm text-fg-muted line-through">{c.wrong}</span>
              <span className="text-body-sm font-medium">{c.right}</span>
              <span className="text-caption text-fg-secondary">{c.why}</span>
            </li>
          ))}
        </ul>
      )}

      {(feedback.explanation || explanation) && (
        <p className="text-body-sm text-fg-secondary">{feedback.explanation || explanation}</p>
      )}
    </div>
  );
}

function ResultView({ slug, result, mode }: { slug: string; result: GrammarResult; mode: string }) {
  const router = useRouter();
  const wrong = useMemo(() => result.review.filter((r) => !r.correct), [result.review]);

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <header className="grid gap-2 text-center">
        <p className="text-label text-fg-muted">{result.topic_name} practice</p>
        <p className="text-display tabular-nums">{Math.round(result.score)}%</p>
        <p className="text-body text-fg-secondary">
          {result.correct} of {result.total} correct
        </p>
        <p className="flex justify-center">
          <StateBadge state={result.mastery.state} mastery={result.mastery.mastery} />
        </p>
      </header>

      <section aria-labelledby="mastery-title" className="grid gap-3 rounded-xl border bg-surface p-5">
        <h2 id="mastery-title" className="text-h4">
          Mastery
        </h2>
        <div className="grid gap-2">
          {(
            [
              ["Understanding", result.mastery.understanding],
              ["Practice", result.mastery.practice],
              ["Application", result.mastery.application],
            ] as const
          ).map(([label, value]) => (
            <Meter
              key={label}
              label={label}
              value={value}
              display={`${Math.round(value)}%`}
              tone={value >= 80 ? "success" : value < 50 ? "warning" : "primary"}
            />
          ))}
        </div>
        <p className="text-caption text-fg-muted">
          Mastery combines what you understand, how you do in practice, and whether you use it in your own
          English — not just this score.
        </p>
      </section>

      {result.by_rule.length > 0 && <Breakdown title="By rule" rows={result.by_rule} />}
      {result.by_type.length > 0 && <Breakdown title="By question type" rows={result.by_type} />}
      {result.by_difficulty.length > 0 && <Breakdown title="By difficulty" rows={result.by_difficulty} />}

      {wrong.length > 0 && (
        <section aria-labelledby="review-title" className="grid gap-3">
          <h2 id="review-title" className="text-h4">
            Review
          </h2>
          <ul className="grid gap-2">
            {wrong.map((item) => (
              <li key={item.question_id} className="grid gap-1 rounded-xl border-l-2 border-warning bg-surface px-4 py-3">
                <p className="text-body-sm">{item.prompt}</p>
                {item.expected && (
                  <p className="text-body-sm">
                    <span className="text-fg-muted">Correct answer: </span>
                    <span className="font-medium">{item.expected}</span>
                  </p>
                )}
                {item.explanation && <p className="text-caption text-fg-secondary">{item.explanation}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.next && (
        <section aria-labelledby="next-title" className="grid gap-2 rounded-xl border bg-surface p-5">
          <h2 id="next-title" className="flex items-center gap-2 text-h4">
            <Target className="size-4 text-primary" aria-hidden />
            Do this next
          </h2>
          <p className="text-body-sm font-medium">{result.next.label}</p>
          <p className="text-caption text-fg-muted">{result.next.reason}</p>
          <div className="pt-1">
            <Button size="sm" asChild>
              <Link href={nextStepHref(result.next, slug)}>
                Start <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            // A fresh navigation rather than local state, so a new run really is new.
            router.replace(`/app/grammar/${slug}/practice?mode=${mode}&r=${Date.now()}`);
            router.refresh();
          }}
        >
          <RotateCw aria-hidden />
          Practise again
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/app/grammar/${slug}`}>Back to {result.topic_name}</Link>
        </Button>
      </div>
    </div>
  );
}

function nextStepHref(next: NonNullable<GrammarResult["next"]>, slug: string): string {
  switch (next.kind) {
    case "practice_rule":
      return `/app/grammar/${next.topic ?? slug}/practice?rule=${encodeURIComponent(next.rule ?? "")}`;
    case "next_topic":
      return `/app/grammar/${next.topic}`;
    case "apply_writing":
      return "/app/writing";
    case "apply_speaking":
      return "/app/speaking";
    default:
      return `/app/grammar/${slug}`;
  }
}

function Breakdown({ title, rows }: { title: string; rows: GrammarResult["by_rule"] }) {
  return (
    <section aria-label={title} className="grid gap-2">
      <h2 className="text-label text-fg-muted">{title}</h2>
      <ul className="grid gap-2 rounded-xl border bg-surface p-4">
        {rows.map((row) => (
          <li key={row.key}>
            <Meter
              label={row.label}
              value={row.accuracy}
              display={`${row.correct}/${row.total}`}
              tone={row.accuracy >= 80 ? "success" : row.accuracy < 70 ? "warning" : "primary"}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "target_grammar":
      return "Target grammar";
    case "grammar":
      return "Grammar";
    case "vocabulary":
      return "Word choice";
    case "spelling":
      return "Spelling";
    default:
      return "Style";
  }
}

function humanizeRule(rule: string): string {
  const text = rule.replace(/[-_]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
