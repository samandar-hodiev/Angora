"use client";

import type { AssessmentItem, AssessmentStimulus } from "@engora/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";

import { assessmentApi } from "../api";
import { useAnswerSaver, useCountdown } from "../use-section-timing";

import type { SectionProps } from "./section-runner";
import { ConfirmDialog, SectionHeader } from "./section-parts";

const typeLabels: Record<string, string> = {
  multiple_choice: "Choose the best answer",
  true_false_not_given: "True, false or not given?",
  vocabulary_in_context: "Vocabulary",
};

/** Reading and listening: one question at a time, with its passage or recording alongside. */
export function ObjectiveSection({ assessment, content, receivedAt, onSubmit, submitting }: SectionProps) {
  const { items, stimuli, section } = content;
  const saver = useAnswerSaver(assessment.id, section.skill);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(content.answers.flatMap((a) => (a.response.option_id ? [[a.item_id, a.response.option_id]] : []))),
  );
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((it) => !answers[it.id])));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  const finish = async () => {
    setConfirmOpen(false);
    await saver.flush();
    onSubmit();
  };

  const remaining = useCountdown({
    deadlineAt: section.deadline_at,
    serverTime: content.server_time,
    receivedAt,
    onExpire: () => void finish(),
  });

  const item = items[index]!;
  const stimulus = stimuli.find((s) => s.id === item.stimulus_id);
  const answeredCount = items.filter((it) => answers[it.id]).length;

  const choose = (optionId: string) => {
    setAnswers((current) => ({ ...current, [item.id]: optionId }));
    saver.save(item.id, { option_id: optionId }, Date.now() - shownAt.current);
  };

  return (
    <div className="grid gap-5 py-4 sm:py-6">
      <SectionHeader
        section={section}
        sectionCount={assessment.sections.length}
        label={`Question ${index + 1} of ${items.length}`}
        remainingMs={remaining}
        progress={(answeredCount / items.length) * 100}
        saveState={saver.state}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {stimulus && <StimulusPanel key={stimulus.id} assessmentId={assessment.id} stimulus={stimulus} maxPlays={section.max_plays ?? 2} />}
        <QuestionCard key={item.id} item={item} index={index} total={items.length} value={answers[item.id]} onChange={choose} />
      </div>

      <nav aria-label="Questions" className="grid gap-3 sm:flex sm:items-center sm:justify-between">
        <Button variant="outline" onClick={() => setIndex((i) => i - 1)} disabled={index === 0} className="order-2 sm:order-none">
          <ArrowLeft aria-hidden /> Previous
        </Button>
        <ol className="order-1 flex flex-wrap justify-center gap-1.5 sm:order-none">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Question ${i + 1}${answers[it.id] ? ", answered" : ""}`}
                aria-current={i === index ? "step" : undefined}
                className={cn(
                  "grid size-8 place-items-center rounded-md border text-caption tabular-nums transition-colors duration-micro outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  answers[it.id] ? "border-primary/40 bg-primary-subtle/50" : "bg-surface/40",
                  i === index && "border-primary ring-1 ring-primary",
                )}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
        {index < items.length - 1 ? (
          <Button onClick={() => setIndex((i) => i + 1)} className="order-3 sm:order-none">
            Next <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button
            variant="liquid"
            loading={submitting}
            className="order-3 sm:order-none"
            onClick={() => (answeredCount < items.length ? setConfirmOpen(true) : void finish())}
          >
            Finish section
          </Button>
        )}
      </nav>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Finish this section?"
        description={`${items.length - answeredCount} ${items.length - answeredCount === 1 ? "question is" : "questions are"} unanswered. Unanswered questions count as incorrect.`}
        confirmLabel="Finish section"
        onConfirm={() => void finish()}
      />
    </div>
  );
}

function QuestionCard({
  item,
  index,
  total,
  value,
  onChange,
}: {
  item: AssessmentItem;
  index: number;
  total: number;
  value: string | undefined;
  onChange: (optionId: string) => void;
}) {
  const promptId = `question-${item.id}`;
  return (
    <section aria-labelledby={promptId} className="journey-card grid gap-5 rounded-2xl p-5 sm:p-6">
      <div className="grid gap-1.5">
        <p className="text-label text-fg-muted">
          {typeLabels[item.type] ?? "Question"} · {index + 1}/{total}
        </p>
        <h2 id={promptId} className="text-h3 text-balance">
          {item.prompt}
        </h2>
        {item.type === "true_false_not_given" && (
          <p className="text-caption text-fg-muted">True: the text says this. False: the text says the opposite. Not given: the text doesn&apos;t say.</p>
        )}
      </div>
      <RadioGroupPrimitive.Root value={value ?? ""} onValueChange={onChange} aria-labelledby={promptId} className="grid gap-2.5">
        {item.options.map((option, i) => (
          <RadioGroupPrimitive.Item
            key={option.id}
            value={option.id}
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl border bg-surface/50 px-4 py-3 text-left text-body-sm outline-none",
              "transition-[background-color,border-color] duration-micro ease-standard hover:border-primary/40 hover:bg-surface-hover",
              "data-[state=checked]:border-primary data-[state=checked]:bg-primary-subtle/50 focus-visible:ring-[3px] focus-visible:ring-ring/40",
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md border text-caption font-semibold transition-colors group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground">
              {String.fromCharCode(65 + i)}
            </span>
            <span className="flex-1">{option.text}</span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </section>
  );
}

function StimulusPanel({ assessmentId, stimulus, maxPlays }: { assessmentId: string; stimulus: AssessmentStimulus; maxPlays: number }) {
  if (stimulus.type === "reading_passage") {
    return (
      <article className="journey-card grid gap-3 rounded-2xl p-5 sm:p-6 lg:sticky lg:top-28 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
        <p className="text-label text-fg-muted">Read the text</p>
        <h2 className="text-h3">{stimulus.title}</h2>
        <div className="grid gap-3 text-body leading-relaxed text-fg-secondary">
          {stimulus.passage?.split("\n\n").map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        </div>
      </article>
    );
  }
  return (
    <div className="journey-card grid gap-4 rounded-2xl p-5 sm:p-6 lg:sticky lg:top-28">
      <p className="text-label text-fg-muted">Listen to the recording</p>
      <h2 className="text-h3">{stimulus.title}</h2>
      <ClipPlayer assessmentId={assessmentId} stimulus={stimulus} maxPlays={maxPlays} />
      <p className="text-caption text-fg-muted">The transcript is available after the test.</p>
    </div>
  );
}

function readPlays(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

/** Listening clip with a play limit. The audio streams from object storage through the API. */
function ClipPlayer({ assessmentId, stimulus, maxPlays }: { assessmentId: string; stimulus: AssessmentStimulus; maxPlays: number }) {
  const audio = useQuery({
    queryKey: [...queryKeys.assessments.detail(assessmentId), "audio", stimulus.id],
    queryFn: () => assessmentApi.audio(assessmentId, stimulus.id),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
  const url = useMemo(() => (audio.data ? URL.createObjectURL(audio.data) : null), [audio.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const storageKey = `engora-plays:${assessmentId}:${stimulus.id}`;
  const [plays, setPlays] = useState(() => readPlays(storageKey));
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const element = useRef<HTMLAudioElement>(null);
  const left = Math.max(0, maxPlays - plays);
  const atStart = progress === 0;

  const toggle = () => {
    const el = element.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    if (atStart) {
      if (left === 0) return;
      const next = plays + 1;
      setPlays(next);
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // ignore
      }
    }
    void el.play();
  };

  if (audio.isPending) return <Skeleton className="h-16 rounded-xl" />;
  if (audio.isError) {
    return <ErrorState title="We couldn't load the recording" error={audio.error} onRetry={() => void audio.refetch()} className="py-6" />;
  }

  return (
    <div className="grid gap-3">
      <audio
        ref={element}
        src={url ?? undefined}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false);
          setProgress(0);
          e.currentTarget.currentTime = 0;
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (!el.ended) setProgress(el.duration ? (el.currentTime / el.duration) * 100 : 0);
        }}
      />
      <div className="flex items-center gap-4">
        <Button
          size="icon"
          variant={playing ? "outline" : "liquid"}
          className="size-12 shrink-0 rounded-full"
          onClick={toggle}
          disabled={!playing && atStart && left === 0}
          aria-label={playing ? "Pause recording" : "Play recording"}
        >
          {playing ? <Pause aria-hidden /> : <Play className="fill-current" aria-hidden />}
        </Button>
        <div className="grid flex-1 gap-1.5">
          <Progress value={progress} aria-label="Playback progress" className="h-1.5" />
          <p className="text-caption text-fg-muted" aria-live="polite">
            {left === 0 && atStart && !playing ? "You've used all plays for this recording." : `Plays left: ${left} of ${maxPlays}`}
          </p>
        </div>
      </div>
    </div>
  );
}
