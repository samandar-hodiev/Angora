"use client";

import { Loader2, MessageCircle, Mic, PhoneOff, Radio } from "lucide-react";
import { useState } from "react";

import { AudioRecorder } from "@/components/learning/audio-recorder";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EntitlementGate } from "@/features/subscription/components/subscription-views";
import { formatCategory } from "@/lib/learning-format";

import { useSpeakingTasks } from "./hooks";
import { useLiveSpeaking } from "./live-speaking";

const MAX_TURN_MS = 90_000;

/**
 * The live speaking coach.
 *
 * Ordinary speaking practice is one recording judged once, afterwards. This is a
 * conversation: you answer, you hear what was wrong with the answer, and the coach asks you
 * something else — all before you leave the page, so the correction lands while you can
 * still use it in the next sentence.
 *
 * What it is honestly not: streaming recognition. Each turn is recorded and sent whole. The
 * page says "recording" and then "listening", never a fake live transcript, because a
 * transcript that is guessing looks like the product working and is actually the product
 * lying.
 */
export function LiveSpeakingView() {
  return (
    <>
      <PageHeader
        title="Live coach"
        description="Speak a turn, hear what to fix, answer the next question. The whole conversation is saved as one practice session."
      />
      <EntitlementGate feature="speaking.live_coach">
        <LiveSession />
      </EntitlementGate>
    </>
  );
}

function LiveSession() {
  const tasks = useSpeakingTasks();
  const live = useLiveSpeaking();
  const [taskId, setTaskId] = useState<string | undefined>();

  const items = tasks.data?.items ?? [];

  if (tasks.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (tasks.isError) return <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />;

  if (live.status === "idle") {
    return (
      <div className="grid gap-5 rounded-xl border bg-surface p-6">
        <div className="grid gap-1">
          <h2 className="text-h3">Ready to talk?</h2>
          <p className="text-body-sm text-fg-secondary">
            You will be asked a question, record an answer, and get feedback on it before the next question. Up to a
            minute and a half per turn.
          </p>
        </div>

        {items.length > 0 && (
          <div className="grid max-w-md gap-2">
            <Label htmlFor="live-topic">Start from</Label>
            <NativeSelect id="live-topic" value={taskId ?? ""} onChange={(e) => setTaskId(e.target.value || undefined)}>
              <option value="">Anything — let the coach choose</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.level ? `${item.level} · ` : ""}
                  {item.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        <div>
          <Button size="lg" onClick={() => void live.connect(taskId)}>
            <Radio aria-hidden />
            Start the conversation
          </Button>
        </div>
      </div>
    );
  }

  if (live.status === "connecting") {
    return (
      <div className="grid justify-items-center gap-3 rounded-xl border bg-surface p-10 text-center">
        <Loader2 className="size-5 animate-spin text-fg-muted motion-reduce:animate-none" aria-hidden />
        <p className="text-body-sm text-fg-secondary">Connecting to your coach…</p>
      </div>
    );
  }

  if (live.status === "error") {
    return (
      <div className="grid justify-items-center gap-3 rounded-xl border bg-surface p-10 text-center" role="alert">
        <p className="text-h4">The conversation stopped</p>
        <p className="max-w-sm text-body-sm text-fg-secondary">{live.error}</p>
        <Button variant="outline" onClick={() => void live.connect(taskId)}>
          Try again
        </Button>
      </div>
    );
  }

  if (live.status === "finished") {
    return <Summary live={live} onRestart={() => void live.connect(taskId)} />;
  }

  const thinking = live.status === "thinking";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
      <div className="grid gap-4">
        <article className="grid gap-3 rounded-xl border bg-surface p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              Turn {live.turns.length + 1}
              {live.maxTurns > 0 ? ` of ${live.maxTurns}` : ""}
            </Badge>
            {live.level && <Badge variant="outline">{live.level}</Badge>}
          </div>
          <p className="flex items-start gap-2 text-h4">
            <MessageCircle className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
            {live.prompt}
          </p>
        </article>

        {thinking ? (
          <div className="grid justify-items-center gap-3 rounded-xl border bg-surface p-10 text-center" aria-live="polite">
            <Loader2 className="size-5 animate-spin text-fg-muted motion-reduce:animate-none" aria-hidden />
            <p className="text-body-sm text-fg-secondary">Listening to what you said…</p>
          </div>
        ) : (
          // Remounted per turn so the recorder starts clean rather than offering to replay
          // the previous answer.
          <AudioRecorder
            key={live.turns.length}
            maxDurationMs={MAX_TURN_MS}
            renderSubmit={(recording) => (
              <Button
                size="lg"
                onClick={() => void live.sendTurn(recording.blob, recording.mimeType, recording.durationMs)}
              >
                <Mic aria-hidden />
                Send this answer
              </Button>
            )}
          />
        )}

        {live.error && (
          <p role="alert" className="rounded-lg border border-error/40 bg-error/5 p-3 text-body-sm text-error">
            {live.error}
          </p>
        )}

        <div>
          <Button variant="outline" onClick={live.finish} disabled={thinking}>
            <PhoneOff aria-hidden />
            End the conversation
          </Button>
        </div>
      </div>

      <Conversation turns={live.turns} />
    </div>
  );
}

function Conversation({ turns }: { turns: ReturnType<typeof useLiveSpeaking>["turns"] }) {
  if (turns.length === 0) {
    return (
      <EmptyState
        title="Nothing said yet"
        description="Your answers and the feedback on them will appear here as you go."
        className="py-10"
      />
    );
  }

  return (
    <ol className="grid gap-4">
      {[...turns].reverse().map((turn) => (
        <li key={turn.turn} className="grid gap-3 rounded-xl border bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-label text-fg-muted">Turn {turn.turn}</span>
            <span className="text-body-sm tabular-nums">{Math.round(turn.score)}/100</span>
          </div>
          <p className="text-body-sm text-fg-secondary">&ldquo;{turn.transcript}&rdquo;</p>

          {turn.feedback && (
            <div className="grid gap-2 border-t pt-3">
              <Meter label="Fluency" value={turn.feedback.fluency} />
              <Meter label="Grammar" value={turn.feedback.grammar} />
              <Meter label="Vocabulary" value={turn.feedback.vocabulary} />
              <Meter label="Relevance" value={turn.feedback.relevance} />
            </div>
          )}

          {turn.feedback && turn.feedback.mistakes.length > 0 && (
            <ul className="grid gap-2 border-t pt-3">
              {turn.feedback.mistakes.slice(0, 3).map((mistake, index) => (
                <li key={`${turn.turn}-${index}`} className="grid gap-0.5 text-body-sm">
                  <span className="text-caption text-fg-muted">{formatCategory(mistake.category)}</span>
                  <span>
                    <span className="text-error line-through">{mistake.original}</span>{" "}
                    <span className="text-success">{mistake.correction}</span>
                  </span>
                  <span className="text-caption text-fg-secondary">{mistake.explanation}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-caption text-fg-muted tabular-nums">
            {Math.round(turn.words_per_minute)} words a minute
          </p>
        </li>
      ))}
    </ol>
  );
}

function Summary({ live, onRestart }: { live: ReturnType<typeof useLiveSpeaking>; onRestart: () => void }) {
  const { summary, turns } = live;

  if (!summary || summary.turns === 0) {
    return (
      <div className="grid justify-items-center gap-3 rounded-xl border bg-surface p-10 text-center">
        <p className="text-h4">That conversation ended before it started</p>
        <p className="max-w-sm text-body-sm text-fg-secondary">Nothing was recorded, so nothing was saved.</p>
        <Button onClick={onRestart}>Start again</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="grid gap-4 rounded-xl border bg-surface p-6">
        <h2 className="text-h3">Conversation saved</h2>
        <dl className="grid gap-3 text-body-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Turns</dt>
            <dd className="text-h3 tabular-nums">{summary.turns}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Average score</dt>
            <dd className="text-h3 tabular-nums">
              {summary.overall_score === undefined ? "—" : Math.round(summary.overall_score)}
            </dd>
          </div>
        </dl>
        <p className="text-caption text-fg-muted">
          It counts towards your speaking progress like any other practice session, and you can reread it from your
          history.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRestart}>
            <Radio aria-hidden />
            Another conversation
          </Button>
        </div>
      </div>

      <Conversation turns={turns} />
    </div>
  );
}
