"use client";

import { Clock, FileText } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Meter } from "@/components/ui/data-display";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { useSubmitWriting, useWritingSubmissions, useWritingTasks } from "./hooks";
import type { WritingFeedback } from "./api";

const MIN_WORDS = 20;

/** The product's definition of "how long is this", shared with the IELTS exam view. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Writing practice.
 *
 * The learner writes, submits, and gets back rubric scores and specific corrections. There is
 * no answer key here, so the feedback is the AI's judgement — labelled as an estimate, never
 * as an exam result, and every correction points at the sentence it came from.
 */
export function WritingView({ initialContentId }: { initialContentId?: string }) {
  const tasks = useWritingTasks();
  const history = useWritingSubmissions();
  const submit = useSubmitWriting();

  const [taskId, setTaskId] = useState(initialContentId);
  const [text, setText] = useState("");

  const items = tasks.data?.items ?? [];
  const task = items.find((item) => item.id === taskId) ?? items[0];
  const words = useMemo(() => countWords(text), [text]);
  const target = task?.body.min_words ?? MIN_WORDS;
  const feedback = submit.data?.feedback;

  if (tasks.isPending) {
    return (
      <>
        <PageHeader title="Writing practice" description="Write, submit, and get specific corrections back." />
        <div className="grid gap-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (tasks.isError) {
    return (
      <>
        <PageHeader title="Writing practice" description="Write, submit, and get specific corrections back." />
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Writing practice" description="Write, submit, and get specific corrections back." />
        <EmptyState title="No writing tasks yet" description="Tasks appear here as soon as they are published." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Writing practice"
        description="Write, submit, and get rubric scores and corrections back."
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-4">
          {items.length > 1 && (
            <div className="grid max-w-md gap-2">
              <Label htmlFor="task-picker">Task</Label>
              <NativeSelect
                id="task-picker"
                value={task?.id}
                onChange={(event) => {
                  setTaskId(event.target.value);
                  submit.reset();
                }}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.level ? `${item.level} · ` : ""}
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          <article className="grid gap-4 rounded-xl border bg-surface p-6">
            <div className="flex flex-wrap gap-2">
              {task?.level && <Badge variant="secondary">{task.level}</Badge>}
              {task?.body.min_words && <Badge variant="outline">{task.body.min_words}+ words</Badge>}
              {task?.body.recommended_minutes && (
                <Badge variant="outline">
                  <Clock aria-hidden /> {task.body.recommended_minutes} min
                </Badge>
              )}
            </div>
            <h2 className="text-h3">{task?.title}</h2>
            {task?.body.prompt && <p className="text-body">{task.body.prompt}</p>}
            {task?.body.instructions && task.body.instructions.length > 0 && (
              <ul className="grid gap-1.5">
                {task.body.instructions.map((instruction) => (
                  <li key={instruction} className="flex items-start gap-2 text-body-sm text-fg-secondary">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {instruction}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="writing-text">Your answer</Label>
              <span
                className={cn(
                  "text-caption tabular-nums",
                  words >= target ? "text-success" : "text-fg-muted",
                )}
              >
                {words} / {target} words
              </span>
            </div>
            <Textarea
              id="writing-text"
              rows={14}
              value={text}
              disabled={submit.isPending}
              placeholder="Write your answer here."
              onChange={(event) => setText(event.target.value)}
            />
            {submit.isError && (
              <p role="alert" className="text-body-sm text-error">
                {isApiError(submit.error) ? submit.error.message : "Your answer could not be checked."}
              </p>
            )}
            <Button
              className="w-fit"
              loading={submit.isPending}
              disabled={words < MIN_WORDS}
              onClick={() => submit.mutate({ task_id: task?.id, prompt: task?.body.prompt, text })}
            >
              Check my writing
            </Button>
            {words < MIN_WORDS && (
              <p className="text-caption text-fg-muted">
                Write at least {MIN_WORDS} words so the feedback can say something useful.
              </p>
            )}
          </div>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-20 lg:self-start">
          {feedback ? (
            <FeedbackCard feedback={feedback} score={submit.data?.overall_score ?? null} />
          ) : (
            <div className="grid gap-2 rounded-xl border border-dashed bg-surface p-6">
              <p className="flex items-center gap-2 text-label">
                <FileText className="size-4 text-fg-muted" aria-hidden />
                Feedback appears here
              </p>
              <p className="text-body-sm text-fg-secondary">
                You get four rubric scores, an estimated level and the specific corrections your text needs.
              </p>
            </div>
          )}

          {(history.data?.items.length ?? 0) > 0 && (
            <div className="grid gap-3 rounded-xl border bg-surface p-5">
              <h2 className="text-h4">Previous submissions</h2>
              <ul className="grid gap-2">
                {history.data!.items.slice(0, 5).map((submission) => (
                  <li key={submission.id} className="flex items-baseline justify-between gap-3 text-body-sm">
                    <span className="truncate text-fg-secondary">{submission.prompt || "Free writing"}</span>
                    <span className="shrink-0 tabular-nums">
                      {submission.overall_score !== null ? `${Math.round(submission.overall_score)}%` : submission.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function FeedbackCard({ feedback, score }: { feedback: WritingFeedback; score: number | null }) {
  const criteria = [
    { label: "Task response", value: feedback.task_response },
    { label: "Grammar", value: feedback.grammar },
    { label: "Vocabulary", value: feedback.vocabulary },
    { label: "Coherence", value: feedback.coherence },
  ];

  return (
    <div className="grid gap-4 rounded-xl border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-h3">Feedback</h2>
        {score !== null && <span className="text-h3 tabular-nums">{Math.round(score)}%</span>}
      </div>

      <p className="text-body-sm text-fg-secondary">
        AI-estimated level: <strong className="text-foreground">{feedback.cefr_estimate}</strong>
        <span className="text-fg-muted"> · confidence {feedback.confidence.toFixed(2)}</span>
      </p>

      <div className="grid gap-3">
        {criteria.map((criterion) => (
          <Meter
            key={criterion.label}
            label={criterion.label}
            value={criterion.value}
            display={`${Math.round(criterion.value)}`}
            tone={criterion.value > 70 ? "success" : criterion.value < 45 ? "warning" : "primary"}
          />
        ))}
      </div>

      {feedback.mistakes.length > 0 && (
        <div className="grid gap-2 border-t pt-3">
          <h3 className="text-label">Corrections</h3>
          <ul className="grid gap-2.5">
            {feedback.mistakes.map((mistake, index) => (
              <li key={index} className="grid gap-1 rounded-lg border bg-surface-hover p-3">
                <p className="text-body-sm">
                  <span className="text-error line-through">{mistake.original}</span>
                  {" → "}
                  <span className="text-success">{mistake.correction}</span>
                </p>
                <p className="text-caption text-fg-muted">{mistake.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-caption text-fg-muted">
        This is an AI estimate to practise against, not an official exam score.
      </p>
    </div>
  );
}
