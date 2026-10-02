"use client";

import { Clock, FileText, Sparkles, Target } from "lucide-react";
import Link from "next/link";
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

import { useSubmitWriting, useTopicWritingTask, useWritingSubmissions, useWritingTasks } from "./hooks";
import type { WritingFeedback } from "./api";

const MIN_WORDS = 20;

/** The product's definition of "how long is this", shared with the IELTS exam view. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** What the learner is answering: a library task, or one written for a grammar topic. */
interface ActiveTask {
  key: string;
  title: string;
  level: string | null;
  prompt?: string;
  instructions: string[];
  minWords?: number;
  minutes?: number;
  /** Library tasks are submitted by id; topic tasks carry their prompt and topic instead. */
  taskId?: string;
  topic?: { slug: string; name: string };
  focus?: string;
}

const TOPIC_KEY = "topic";

/**
 * Writing practice.
 *
 * The learner writes, submits, and gets back rubric scores and specific corrections. There is
 * no answer key here, so the feedback is the AI's judgement — labelled as an estimate, never
 * as an exam result, and every correction points at the sentence it came from.
 *
 * Arriving from a grammar topic ("Use it in real English → Writing"), the first task is one
 * written for that topic, and the check is told to judge that grammar first. The editor takes
 * the full width — this is a page for writing, and a narrow column is a worse place to write —
 * and it does not accept pasted text: the feedback is about the learner's English, and text
 * from somewhere else would make it about somebody else's.
 */
export function WritingView({ initialContentId, grammarTopic }: { initialContentId?: string; grammarTopic?: string }) {
  const tasks = useWritingTasks();
  const topicTask = useTopicWritingTask(grammarTopic);
  const history = useWritingSubmissions();
  const submit = useSubmitWriting();

  const [selected, setSelected] = useState<string | undefined>(
    initialContentId ?? (grammarTopic ? TOPIC_KEY : undefined),
  );
  const [text, setText] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);

  const items = tasks.data?.items ?? [];
  const options: ActiveTask[] = [
    ...(topicTask.data
      ? [
          {
            key: TOPIC_KEY,
            title: topicTask.data.title,
            level: topicTask.data.level,
            prompt: topicTask.data.prompt,
            instructions: topicTask.data.instructions,
            minWords: topicTask.data.min_words,
            minutes: topicTask.data.recommended_minutes,
            topic: topicTask.data.topic,
            focus: topicTask.data.focus,
          },
        ]
      : []),
    ...items.map((item) => ({
      key: item.id,
      title: item.title,
      level: item.level,
      prompt: item.body.prompt,
      instructions: item.body.instructions ?? [],
      minWords: item.body.min_words,
      minutes: item.body.recommended_minutes,
      taskId: item.id,
    })),
  ];
  const task = options.find((option) => option.key === selected) ?? options[0];
  const words = useMemo(() => countWords(text), [text]);
  const target = task?.minWords ?? MIN_WORDS;
  const feedback = submit.data?.feedback;

  const header = (
    <PageHeader title="Writing practice" description="Write, submit, and get rubric scores and corrections back." />
  );

  // The topic task is what the learner came for: wait for it rather than flashing the library.
  if (tasks.isPending || (grammarTopic && topicTask.isPending)) {
    return (
      <>
        {header}
        <div className="grid gap-4">
          {grammarTopic && (
            <p className="flex items-center gap-2 text-body-sm text-fg-secondary">
              <Sparkles className="size-4 animate-pulse text-primary" aria-hidden />
              Writing a task for the grammar you just studied…
            </p>
          )}
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </>
    );
  }

  if (tasks.isError && options.length === 0) {
    return (
      <>
        {header}
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      </>
    );
  }

  if (!task) {
    return (
      <>
        {header}
        <EmptyState title="No writing tasks yet" description="Tasks appear here as soon as they are published." />
      </>
    );
  }

  /** Copying, cutting, pasting and dropping text are refused, and the learner is told why. */
  const refuse = (what: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setBlocked(what);
  };

  return (
    <>
      {header}

      <div className="grid gap-6">
        {options.length > 1 && (
          <div className="grid max-w-xl gap-2">
            <Label htmlFor="task-picker">Task</Label>
            <NativeSelect
              id="task-picker"
              value={task.key}
              onChange={(event) => {
                setSelected(event.target.value);
                submit.reset();
              }}
            >
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.topic ? `For ${option.topic.name} · ` : option.level ? `${option.level} · ` : ""}
                  {option.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        <article className="grid gap-4 rounded-xl border bg-surface p-6">
          <div className="flex flex-wrap items-center gap-2">
            {task.topic && (
              <Badge variant="success">
                <Target aria-hidden /> Practising {task.topic.name}
              </Badge>
            )}
            {task.level && <Badge variant="secondary">{task.level}</Badge>}
            {task.minWords && <Badge variant="outline">{task.minWords}+ words</Badge>}
            {task.minutes && (
              <Badge variant="outline">
                <Clock aria-hidden /> {task.minutes} min
              </Badge>
            )}
          </div>
          <h2 className="text-h3">{task.title}</h2>
          {task.prompt && <p className="text-body">{task.prompt}</p>}
          {task.instructions.length > 0 && (
            <ul className="grid gap-1.5">
              {task.instructions.map((instruction) => (
                <li key={instruction} className="flex items-start gap-2 text-body-sm text-fg-secondary">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {instruction}
                </li>
              ))}
            </ul>
          )}
          {task.topic && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/25 bg-primary-subtle/60 px-3 py-2 text-body-sm">
              <Target className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                {task.focus || `This task practises ${task.topic.name}.`} The check looks at it first.
              </span>
              <Link href={`/app/grammar/${task.topic.slug}`} className="text-caption font-medium text-primary hover:underline">
                Review the rule
              </Link>
            </p>
          )}
        </article>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="writing-text">Your answer</Label>
            <span className={cn("text-caption tabular-nums", words >= target ? "text-success" : "text-fg-muted")}>
              {words} / {target} words
            </span>
          </div>
          <Textarea
            id="writing-text"
            rows={16}
            value={text}
            disabled={submit.isPending}
            placeholder="Write your answer here, in your own words."
            className="min-h-[24rem] w-full text-body leading-relaxed"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="sentences"
            aria-describedby="writing-rules"
            onChange={(event) => {
              setText(event.target.value);
              if (blocked) setBlocked(null);
            }}
            onPaste={refuse("Pasting")}
            onCopy={refuse("Copying")}
            onCut={refuse("Cutting")}
            onDrop={refuse("Dropping text")}
            onDragOver={(event) => event.preventDefault()}
          />
          <p id="writing-rules" aria-live="polite" className={cn("text-caption", blocked ? "text-warning-text" : "text-fg-muted")}>
            {blocked
              ? `${blocked} is turned off here — type it yourself, so the feedback is about your English.`
              : "Copy and paste are turned off: write it yourself, so the feedback is about your English."}
          </p>
          {submit.isError && (
            <p role="alert" className="text-body-sm text-error">
              {isApiError(submit.error) ? submit.error.message : "Your answer could not be checked."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="w-fit"
              loading={submit.isPending}
              disabled={words < MIN_WORDS}
              onClick={() =>
                submit.mutate({
                  task_id: task.taskId,
                  prompt: task.prompt,
                  text,
                  grammar_topic: task.topic?.slug,
                })
              }
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

        {feedback ? (
          <FeedbackCard feedback={feedback} score={submit.data?.overall_score ?? null} focus={task.topic?.name} />
        ) : (
          <div className="grid gap-2 rounded-xl border border-dashed bg-surface p-6">
            <p className="flex items-center gap-2 text-label">
              <FileText className="size-4 text-fg-muted" aria-hidden />
              Feedback appears here
            </p>
            <p className="text-body-sm text-fg-secondary">
              You get four rubric scores, an estimated level and the specific corrections your text needs
              {task.topic ? ` — starting with how you used ${task.topic.name}.` : "."}
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
      </div>
    </>
  );
}

function FeedbackCard({ feedback, score, focus }: { feedback: WritingFeedback; score: number | null; focus?: string }) {
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
          {focus && <p className="text-caption text-fg-muted">Mistakes with {focus} come first.</p>}
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
