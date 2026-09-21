"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { usePracticeSet, usePracticeSets, useCompleteAttempt, useStartAttempt } from "./hooks";
import type { PracticeAnswer, PracticeMark, PracticeQuestion, PracticeSkill } from "./api";

/**
 * The shared shape of reading and listening practice: a stimulus on one side, its questions on
 * the other, and a result that arrives from the server.
 *
 * Nothing is marked in the browser. The learner's answers go to the API, which compares them
 * with the answer key it never sent, so the score cannot be changed by anything happening on
 * this page — and the explanations come back with it.
 */
export function AttemptView({
  skill,
  title,
  description,
  pickerLabel,
  renderStimulus,
  initialSetId,
}: {
  skill: PracticeSkill;
  title: string;
  description: string;
  pickerLabel: string;
  renderStimulus: (body: Record<string, unknown>, loading: boolean) => ReactNode;
  initialSetId?: string;
}) {
  const sets = usePracticeSets(skill);
  const [selectedId, setSelectedId] = useState(initialSetId);
  const items = sets.data?.items ?? [];
  const current = items.find((item) => item.id === selectedId) ?? items[0];
  const set = usePracticeSet(skill, current?.id);

  const [answers, setAnswers] = useState<Record<string, PracticeAnswer>>({});
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [marks, setMarks] = useState<PracticeMark[] | null>(null);
  const [score, setScore] = useState<{ correct: number; total: number; score: number } | null>(null);
  // Set when the learner first answers, not on render: time spent should measure working on
  // the questions, not how long the tab happened to be open.
  const startedAt = useRef<number | null>(null);

  const start = useStartAttempt(skill);
  const complete = useCompleteAttempt(skill);

  const questions = useMemo(() => set.data?.questions ?? [], [set.data]);
  const answeredCount = Object.keys(answers).length;
  const finished = marks !== null;

  const reset = useCallback(() => {
    setAnswers({});
    setAttemptId(null);
    setMarks(null);
    setScore(null);
    startedAt.current = null;
  }, []);

  async function submit() {
    if (!current) return;
    try {
      // The attempt is opened on submit rather than on arrival: a learner who reads a
      // passage and leaves has not attempted anything, and should not be recorded as having.
      const attempt = attemptId ? { id: attemptId } : await start.mutateAsync(current.id);
      const result = await complete.mutateAsync({
        attemptId: attempt.id,
        answers,
        timeSpentMs: startedAt.current === null ? 0 : Date.now() - startedAt.current,
      });
      setAttemptId(attempt.id);
      setMarks(result.marks ?? []);
      setScore({ correct: result.correct_count, total: result.total_count, score: result.score ?? 0 });
    } catch {
      // The mutation's error state drives the message below.
    }
  }

  const submitError = start.error ?? complete.error;

  if (sets.isPending) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <div className="grid gap-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (sets.isError) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <ErrorState error={sets.error} onRetry={() => void sets.refetch()} />
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <EmptyState
          title={`No ${skill} practice yet`}
          description="Sets appear here as soon as they are published with their questions."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={title} description={description} />

      {items.length > 1 && (
        <div className="mb-6 grid max-w-md gap-2">
          <Label htmlFor="set-picker">{pickerLabel}</Label>
          <NativeSelect
            id="set-picker"
            value={current?.id}
            onChange={(event) => {
              setSelectedId(event.target.value);
              reset();
            }}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.level ? `${item.level} · ` : ""}
                {item.title}
                {item.best_score !== null ? ` (best ${Math.round(item.best_score)}%)` : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <article className="rounded-xl border bg-surface p-6 sm:p-10">
          <div className="mb-6 flex flex-wrap gap-2">
            {current?.level && <Badge variant="secondary">{current.level}</Badge>}
            <Badge variant="outline">{current?.question_count} questions</Badge>
            {current && current.attempts > 0 && (
              <Badge variant="outline">
                {current.attempts} previous {current.attempts === 1 ? "attempt" : "attempts"}
              </Badge>
            )}
          </div>
          <h2 className="mb-6 text-h1">{current?.title}</h2>
          {renderStimulus(set.data?.body ?? {}, set.isPending)}
        </article>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="grid gap-6 rounded-xl border bg-surface p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-h3">Questions</h2>
              {!finished && questions.length > 0 && (
                <span className="text-label text-fg-muted tabular-nums">
                  {answeredCount} / {questions.length} answered
                </span>
              )}
            </div>

            {score && (
              <div
                role="status"
                className={cn(
                  "grid gap-1 rounded-lg border p-4",
                  score.score >= 70 ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10",
                )}
              >
                <p className="text-h3 tabular-nums">
                  {score.correct} / {score.total}
                </p>
                <p className="text-body-sm text-fg-secondary">
                  {Math.round(score.score)}% — marked against the answer key, and saved to your progress.
                </p>
              </div>
            )}

            {set.isPending ? (
              <div className="grid gap-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : questions.length === 0 ? (
              <p className="text-body-sm text-fg-muted">This set has no published questions yet.</p>
            ) : (
              <ol className="grid gap-6">
                {questions.map((question, index) => (
                  <QuestionItem
                    key={question.id}
                    index={index}
                    question={question}
                    answer={answers[question.id]}
                    mark={marks?.find((m) => m.question_id === question.id)}
                    disabled={finished}
                    onAnswer={(answer) => {
                      startedAt.current ??= Date.now();
                      setAnswers((current) => ({ ...current, [question.id]: answer }));
                    }}
                  />
                ))}
              </ol>
            )}

            {submitError && (
              <p role="alert" className="text-body-sm text-error">
                {isApiError(submitError) ? submitError.message : "Your answers could not be submitted."}
              </p>
            )}

            {finished ? (
              <Button variant="outline" className="w-full" onClick={reset}>
                <RotateCcw aria-hidden />
                Try again
              </Button>
            ) : (
              <Button
                className="w-full"
                loading={start.isPending || complete.isPending}
                disabled={questions.length === 0 || answeredCount === 0}
                onClick={() => void submit()}
              >
                Check answers
              </Button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function QuestionItem({
  index,
  question,
  answer,
  mark,
  disabled,
  onAnswer,
}: {
  index: number;
  question: PracticeQuestion;
  answer?: PracticeAnswer;
  mark?: PracticeMark;
  disabled: boolean;
  onAnswer: (answer: PracticeAnswer) => void;
}) {
  const hasOptions = question.options.length > 0;

  return (
    <li className="grid gap-3">
      <p id={`${question.id}-label`} className="text-h4">
        <span className="mr-2 text-fg-muted tabular-nums">{index + 1}.</span>
        {question.prompt}
      </p>

      {hasOptions ? (
        <RadioGroup
          aria-labelledby={`${question.id}-label`}
          value={answer?.option_id ?? ""}
          onValueChange={(value) => onAnswer({ option_id: value })}
          disabled={disabled}
          className="gap-2"
        >
          {question.options.map((option, optionIndex) => {
            const id = `${question.id}-${option.id}`;
            const isChosen = answer?.option_id === option.id;
            const isKey = mark?.expected.option_id === option.id;
            return (
              <Label
                key={id}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-3.5 py-3 font-normal transition-colors duration-micro",
                  !mark && "hover:bg-surface-hover has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-subtle",
                  // After marking, the key is shown whether or not the learner picked it:
                  // seeing the right answer is the point of checking.
                  mark && isKey && "border-success bg-success/10",
                  mark && isChosen && !isKey && "border-error bg-error/10",
                  disabled && "cursor-default",
                )}
              >
                <Radio id={id} value={option.id} />
                <span className="text-caption font-medium text-fg-muted">{String.fromCharCode(65 + optionIndex)}</span>
                <span className="text-body-sm">{option.text}</span>
                {mark && isKey && <Check className="ml-auto size-4 shrink-0 text-success" aria-hidden />}
                {mark && isChosen && !isKey && <X className="ml-auto size-4 shrink-0 text-error" aria-hidden />}
              </Label>
            );
          })}
        </RadioGroup>
      ) : (
        <Input
          aria-labelledby={`${question.id}-label`}
          value={answer?.text ?? ""}
          disabled={disabled}
          placeholder="Type your answer"
          onChange={(event) => onAnswer({ text: event.target.value })}
          aria-invalid={mark ? !mark.correct : undefined}
        />
      )}

      {mark && !mark.correct && !hasOptions && mark.expected.text && (
        <p className="text-body-sm">
          <span className="text-fg-muted">Answer: </span>
          <span className="text-success">{mark.expected.text}</span>
        </p>
      )}
      {mark?.explanation && (
        <p className={cn("text-body-sm", mark.correct ? "text-fg-muted" : "text-fg-secondary")}>{mark.explanation}</p>
      )}
    </li>
  );
}
