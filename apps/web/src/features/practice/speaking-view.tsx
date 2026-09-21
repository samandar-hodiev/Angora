"use client";

import { Clock, Mic } from "lucide-react";
import { useState } from "react";

import { AudioRecorder } from "@/components/learning/audio-recorder";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Meter } from "@/components/ui/data-display";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api";

import { useSpeakingSessions, useSpeakingTasks, useSubmitSpeaking } from "./hooks";
import type { SpeakingFeedback } from "./api";

const MAX_DURATION_MS = 120_000;

/**
 * Speaking practice.
 *
 * Record, send, read the report. The transcript comes back with it, because the most useful
 * thing after speaking is seeing what you actually said — and because it shows the learner
 * what the feedback was judging.
 */
export function SpeakingView({ initialContentId }: { initialContentId?: string }) {
  const tasks = useSpeakingTasks();
  const history = useSpeakingSessions();
  const submit = useSubmitSpeaking();

  const [taskId, setTaskId] = useState(initialContentId);
  const items = tasks.data?.items ?? [];
  const task = items.find((item) => item.id === taskId) ?? items[0];
  const session = submit.data;

  if (tasks.isPending) {
    return (
      <>
        <PageHeader title="Speaking practice" description="Record an answer and get feedback on how you said it." />
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
        <PageHeader title="Speaking practice" description="Record an answer and get feedback on how you said it." />
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Speaking practice" description="Record an answer and get feedback on how you said it." />
        <EmptyState title="No speaking tasks yet" description="Tasks appear here as soon as they are published." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Speaking practice"
        description="Record an answer. You get the transcript back with feedback on fluency, grammar, vocabulary and relevance."
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-4">
          {items.length > 1 && (
            <div className="grid max-w-md gap-2">
              <Label htmlFor="speaking-task">Task</Label>
              <NativeSelect
                id="speaking-task"
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
              <Badge variant="outline">
                <Clock aria-hidden /> up to {MAX_DURATION_MS / 60_000} min
              </Badge>
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

          <AudioRecorder
            maxDurationMs={MAX_DURATION_MS}
            renderSubmit={(recording) => (
              <div className="grid justify-items-start gap-2">
                <Button
                  loading={submit.isPending}
                  onClick={() =>
                    submit.mutate({
                      blob: recording.blob,
                      mimeType: recording.mimeType,
                      durationMs: recording.durationMs,
                      taskId: task?.id,
                    })
                  }
                >
                  <Mic aria-hidden />
                  Send for feedback
                </Button>
                {submit.isPending && (
                  <p className="text-caption text-fg-muted">
                    Transcribing, then scoring. This takes a few seconds.
                  </p>
                )}
                {submit.isError && (
                  <p role="alert" className="text-body-sm text-error">
                    {isApiError(submit.error) ? submit.error.message : "Your recording could not be checked."}
                  </p>
                )}
              </div>
            )}
          />
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-20 lg:self-start">
          {session?.feedback ? (
            <ReportCard
              feedback={session.feedback}
              score={session.overall_score}
              transcript={session.transcript}
              wordsPerMinute={session.words_per_minute}
            />
          ) : (
            <div className="grid gap-2 rounded-xl border border-dashed bg-surface p-6">
              <p className="flex items-center gap-2 text-label">
                <Mic className="size-4 text-fg-muted" aria-hidden />
                Your report appears here
              </p>
              <p className="text-body-sm text-fg-secondary">
                Speak for at least a few sentences — a short clip cannot be judged fairly.
              </p>
            </div>
          )}

          {(history.data?.items.length ?? 0) > 0 && (
            <div className="grid gap-3 rounded-xl border bg-surface p-5">
              <h2 className="text-h4">Previous recordings</h2>
              <ul className="grid gap-2">
                {history.data!.items.slice(0, 5).map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3 text-body-sm">
                    <span className="truncate text-fg-secondary">{item.prompt || "Free speaking"}</span>
                    <span className="shrink-0 tabular-nums">
                      {item.overall_score !== null ? `${Math.round(item.overall_score)}%` : item.status}
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

function ReportCard({
  feedback,
  score,
  transcript,
  wordsPerMinute,
}: {
  feedback: SpeakingFeedback;
  score: number | null;
  transcript?: string;
  wordsPerMinute?: number;
}) {
  const criteria = [
    { label: "Fluency", value: feedback.fluency },
    { label: "Grammar", value: feedback.grammar },
    { label: "Vocabulary", value: feedback.vocabulary },
    { label: "Relevance", value: feedback.relevance },
  ];

  return (
    <div className="grid gap-4 rounded-xl border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-h3">Your report</h2>
        {score !== null && <span className="text-h3 tabular-nums">{Math.round(score)}%</span>}
      </div>

      <p className="text-body-sm text-fg-secondary">
        AI-estimated level: <strong className="text-foreground">{feedback.cefr_estimate}</strong>
        {wordsPerMinute !== undefined && (
          <span className="text-fg-muted"> · {Math.round(wordsPerMinute)} words per minute</span>
        )}
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

      {transcript && (
        <details className="grid gap-2 border-t pt-3">
          <summary className="cursor-pointer text-label">What you said</summary>
          <p className="mt-2 text-body-sm text-fg-secondary">{transcript}</p>
        </details>
      )}

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
        An AI estimate to practise against, not an official exam score.
      </p>
    </div>
  );
}
