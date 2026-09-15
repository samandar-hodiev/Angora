"use client";

import type { AssessmentItem, SpeakingAttempt } from "@engora/types";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, RotateCcw, Upload } from "lucide-react";
import { useState } from "react";

import { AudioRecorder } from "@/components/learning/audio-recorder";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { errorReason } from "@/features/auth/email";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { formatDuration } from "@/lib/audio";

import { useUploadRecording } from "../hooks";
import { useCountdown } from "../use-section-timing";

import type { SectionProps } from "./section-runner";
import { ConfirmDialog, SectionHeader } from "./section-parts";

/** Speaking tasks: record, review, save; retake within the configured attempt limit. */
export function SpeakingSection({ assessment, content, receivedAt, onSubmit, submitting }: SectionProps) {
  const { items, section } = content;
  const maxAttempts = section.max_attempts ?? 2;
  const attemptsFor = (itemId: string): SpeakingAttempt[] => content.answers.find((a) => a.item_id === itemId)?.attempts ?? [];
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((it) => attemptsFor(it.id).length === 0)));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const remaining = useCountdown({
    deadlineAt: section.deadline_at,
    serverTime: content.server_time,
    receivedAt,
    onExpire: onSubmit,
  });

  const item = items[index]!;
  const recorded = items.filter((it) => attemptsFor(it.id).length > 0).length;

  return (
    <div className="grid gap-5 py-4 sm:py-6">
      <SectionHeader
        section={section}
        sectionCount={assessment.sections.length}
        label={`Task ${index + 1} of ${items.length}`}
        remainingMs={remaining}
        progress={(recorded / items.length) * 100}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <TaskCard item={item} index={index} total={items.length} />
        <SpeakingRecorder key={item.id} assessmentId={assessment.id} item={item} attempts={attemptsFor(item.id)} maxAttempts={maxAttempts} />
      </div>

      <nav aria-label="Speaking tasks" className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
          <ArrowLeft aria-hidden /> Previous task
        </Button>
        {index < items.length - 1 ? (
          <Button onClick={() => setIndex((i) => i + 1)}>
            Next task <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button variant="liquid" loading={submitting} onClick={() => (recorded < items.length ? setConfirmOpen(true) : onSubmit())}>
            Finish test
          </Button>
        )}
      </nav>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Finish without every recording?"
        description="Tasks without a saved recording are scored as unanswered."
        confirmLabel="Finish test"
        onConfirm={() => {
          setConfirmOpen(false);
          onSubmit();
        }}
      />
    </div>
  );
}

function TaskCard({ item, index, total }: { item: AssessmentItem; index: number; total: number }) {
  const { prep_seconds: prep, response_seconds: response, guidance } = item.settings;
  return (
    <section aria-labelledby={`task-${item.id}`} className="journey-card grid gap-4 rounded-2xl p-5 sm:p-6 lg:sticky lg:top-28">
      <p className="text-label text-fg-muted">
        Speaking task {index + 1} of {total}
      </p>
      <h2 id={`task-${item.id}`} className="text-h3 text-balance">
        {item.prompt}
      </h2>
      {guidance && guidance.length > 0 && (
        <div className="grid gap-2">
          <p className="text-label text-fg-muted">You could talk about</p>
          <ul className="grid gap-1.5 text-body-sm text-fg-secondary">
            {guidance.map((g) => (
              <li key={g} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="rounded-lg bg-surface/50 px-3 py-2 text-body-sm text-fg-secondary">
        {prep ? `Take up to ${spokenDuration(prep)} to think, then speak` : "Speak"} for up to {spokenDuration(response ?? 60)}.
      </p>
    </section>
  );
}

/** 45 → "45 seconds", 60 → "1 minute", 75 → "1 minute 15 seconds". */
export function spokenDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  const parts = [];
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

function uploadError(error: unknown): string {
  const reason = errorReason(error);
  if (reason === "attempts_exhausted") return "You've used all recording attempts for this task.";
  if (reason === "time_expired") return "Time is up for this section.";
  if (isApiError(error) && error.code === "UNSUPPORTED_MEDIA_TYPE") return "This recording format isn't supported. Try another browser.";
  if (isApiError(error) && error.code === "NETWORK_ERROR") return "We couldn't upload your recording. Check your connection and try again — your recording is still here.";
  return `${errorMessage(error)} Your recording is still here, so you can try again.`;
}

function SpeakingRecorder({
  assessmentId,
  item,
  attempts,
  maxAttempts,
}: {
  assessmentId: string;
  item: AssessmentItem;
  attempts: SpeakingAttempt[];
  maxAttempts: number;
}) {
  const upload = useUploadRecording(assessmentId);
  const [recording, setRecording] = useState(attempts.length === 0);
  const [error, setError] = useState<string | null>(null);
  const latest = attempts.at(-1);
  const used = attempts.length;

  if (!recording && latest) {
    return (
      <div className="journey-card grid gap-4 rounded-2xl p-6" role="status">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-6 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-h4">Answer saved</p>
            <p className="text-body-sm text-fg-secondary">
              {formatDuration(latest.duration_ms ?? 0)} · Attempt {latest.attempt_number} of {maxAttempts}
            </p>
          </div>
        </div>
        {used < maxAttempts ? (
          <div className="grid gap-2">
            <Button variant="outline" className="justify-self-start" onClick={() => setRecording(true)}>
              <RotateCcw aria-hidden /> Record again
            </Button>
            <p className="text-caption text-fg-muted">
              A new recording replaces this one. {maxAttempts - used} {maxAttempts - used === 1 ? "attempt" : "attempts"} left.
            </p>
          </div>
        ) : (
          <p className="text-caption text-fg-muted">You&apos;ve used all {maxAttempts} attempts. Your last recording will be assessed.</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AudioRecorder
        maxDurationMs={(item.settings.response_seconds ?? 60) * 1000}
        className="journey-card"
        renderSubmit={(rec) => (
          <Button
            size="lg"
            variant="liquid"
            loading={upload.isPending}
            onClick={() => {
              setError(null);
              upload.mutate(
                { itemId: item.id, blob: rec.blob, mimeType: rec.mimeType, durationMs: rec.durationMs },
                { onSuccess: () => setRecording(false), onError: (err) => setError(uploadError(err)) },
              );
            }}
          >
            <Upload aria-hidden /> Save answer
          </Button>
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-fg-muted">
        <span>
          Attempt {Math.min(used + 1, maxAttempts)} of {maxAttempts}
        </span>
        {latest && (
          <Button variant="link" size="sm" className="h-auto" onClick={() => setRecording(false)}>
            Keep my saved answer
          </Button>
        )}
      </div>
    </div>
  );
}
