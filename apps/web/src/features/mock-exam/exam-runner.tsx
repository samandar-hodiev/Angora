"use client";

import type { CEFRLevel } from "./sample";
import { CheckCircle2, Clock, Mic, Play, Square, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { BrandMark } from "@/components/common/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { mockSkillLabels, sampleSection, type MockQuestion, type MockSection, type MockSkill } from "./sample";

/**
 * A mock exam sitting. Exam mode on purpose: no sidebar, no hints, no decoration — the task,
 * a timer and the answers. The timer starts on Start; at zero the section locks and is
 * handed in as it stands, as in the real exam.
 *
 * UI only for now: answers stay in the page and nothing is sent anywhere yet.
 */

type Phase = "intro" | "running" | "done";
type Answers = Record<string, string>;

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds left of `total`, counting down while `running`. */
function useCountdown(total: number, running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    startedAt.current ??= Date.now();
    const tick = () => setElapsed((Date.now() - (startedAt.current ?? Date.now())) / 1000);
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [running]);
  return Math.max(0, total - elapsed);
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function MockExamRunner({ skill, level }: { skill: MockSkill; level: CEFRLevel }) {
  const section = sampleSection(skill, level);
  const [phase, setPhase] = useState<Phase>("intro");
  const [answers, setAnswers] = useState<Answers>({});
  const [essay, setEssay] = useState("");
  const remaining = useCountdown(section.minutes * 60, phase === "running");
  const timeUp = phase === "running" && remaining <= 0;
  // At zero the section is handed in as it stands.
  if (timeUp) setPhase("done");

  const total = section.questions?.length ?? 0;
  const answered = section.questions?.filter((q) => (answers[q.id] ?? "").trim()).length ?? 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <BrandMark />
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <span className="hidden truncate text-body-sm font-medium sm:block">Mock exam · {mockSkillLabels[skill]}</span>
          <Badge variant="outline">{level}</Badge>
          <div className="ml-auto flex items-center gap-2">
            {phase !== "intro" && (
              <span
                role="timer"
                aria-label="Time left"
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-body-sm tabular-nums",
                  phase === "running" && remaining < 300 && "border-warning text-warning-foreground",
                  phase === "done" && "text-fg-muted",
                )}
              >
                <Clock className="size-4" aria-hidden /> {mmss(remaining)}
              </span>
            )}
            {phase === "done" ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/app/mock-exam">Close</Link>
              </Button>
            ) : (
              <ExitDialog started={phase === "running"} />
            )}
          </div>
        </div>
        {phase === "running" && (
          <div className="h-0.5 bg-surface-active" aria-hidden>
            <div className="h-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${(remaining / (section.minutes * 60)) * 100}%` }} />
          </div>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {phase === "intro" && <Intro section={section} onStart={() => setPhase("running")} />}
        {phase === "running" && skill === "reading" && (
          <ReadingSection section={section} answers={answers} onAnswer={setAnswers} onSubmit={() => setPhase("done")} answered={answered} total={total} />
        )}
        {phase === "running" && skill === "listening" && (
          <ListeningSection section={section} answers={answers} onAnswer={setAnswers} onSubmit={() => setPhase("done")} answered={answered} total={total} />
        )}
        {phase === "running" && skill === "writing" && (
          <WritingSection section={section} essay={essay} onChange={setEssay} onSubmit={() => setPhase("done")} />
        )}
        {phase === "running" && skill === "speaking" && <SpeakingSection section={section} onSubmit={() => setPhase("done")} />}
        {phase === "done" && (
          <Done
            skill={skill}
            timeUp={remaining <= 0}
            summary={
              skill === "writing"
                ? `${wordCount(essay)} words written`
                : skill === "speaking"
                  ? "Your answer was recorded"
                  : `${answered} of ${total} questions answered`
            }
          />
        )}
      </main>
    </div>
  );
}

function ExitDialog({ started }: { started: boolean }) {
  const router = useRouter();
  if (!started) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href="/app/mock-exam">
          <X aria-hidden /> Exit
        </Link>
      </Button>
    );
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <X aria-hidden /> Exit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave the exam?</DialogTitle>
          <DialogDescription>The timer does not stop. If you leave now, this section ends and your answers so far are handed in.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep going</Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => router.push("/app/mock-exam")}>
            Leave exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Intro({ section, onStart }: { section: MockSection; onStart: () => void }) {
  return (
    <div className="mx-auto grid max-w-xl gap-5 py-10">
      <div className="grid gap-1.5">
        <p className="text-label text-fg-muted">
          {mockSkillLabels[section.skill]} · {section.level}
        </p>
        <h1 className="text-h2">{section.title}</h1>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-surface p-4">
          <dt className="text-caption text-fg-muted">Time</dt>
          <dd className="text-h3">{section.minutes} min</dd>
        </div>
        <div className="rounded-xl border bg-surface p-4">
          <dt className="text-caption text-fg-muted">{section.task ? "Length" : section.cueCard ? "Speaking" : "Questions"}</dt>
          <dd className="text-h3">
            {section.task ? `${section.task.minWords}+ words` : section.cueCard ? "2 min" : (section.questions?.length ?? 0)}
          </dd>
        </div>
      </dl>
      <p className="text-body text-fg-secondary">{section.instructions}</p>
      <ul className="grid gap-1.5 text-body-sm text-fg-secondary">
        <li>• The timer starts when you press Start and does not pause.</li>
        <li>• When time runs out, the section ends and is handed in as it is.</li>
        <li>• Results appear when you finish — there are no hints during the exam.</li>
      </ul>
      <Button size="lg" onClick={onStart} className="justify-self-start">
        Start <Play aria-hidden />
      </Button>
    </div>
  );
}

function QuestionList({
  questions,
  answers,
  onAnswer,
  disabled = false,
}: {
  questions: MockQuestion[];
  answers: Answers;
  onAnswer: (next: Answers) => void;
  disabled?: boolean;
}) {
  const set = (id: string, value: string) => onAnswer({ ...answers, [id]: value });
  return (
    <ol className="grid gap-4">
      {questions.map((q, index) => (
        <li key={q.id} id={`q-${q.id}`} className="scroll-mt-24 rounded-xl border bg-surface p-4">
          <p className="mb-3 text-body">
            <span className="mr-2 font-semibold tabular-nums text-fg-muted">{index + 1}.</span>
            {q.prompt}
          </p>
          {q.kind === "gap" ? (
            <Input
              aria-label={`Answer to question ${index + 1}`}
              value={answers[q.id] ?? ""}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set(q.id, e.target.value)}
              className="max-w-sm"
            />
          ) : (
            <div role="radiogroup" aria-label={`Question ${index + 1}`} className="grid gap-2 sm:grid-cols-2">
              {(q.kind === "choice" ? q.options : ["True", "False", "Not given"]).map((option, i) => {
                const checked = answers[q.id] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => set(q.id, option)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-body-sm outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      checked ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "hover:bg-surface-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full border text-[0.6875rem] font-semibold",
                        checked && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    {option}
                  </button>
                );
              })}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Numbered chips to jump between questions; filled ones are answered. */
function QuestionNavigator({ questions, answers }: { questions: MockQuestion[]; answers: Answers }) {
  return (
    <nav aria-label="Questions" className="flex flex-wrap gap-1.5">
      {questions.map((q, index) => {
        const done = Boolean((answers[q.id] ?? "").trim());
        return (
          <a
            key={q.id}
            href={`#q-${q.id}`}
            className={cn(
              "grid size-8 place-items-center rounded-md border text-caption font-semibold tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              done ? "border-primary bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover",
            )}
            aria-label={`Question ${index + 1}${done ? ", answered" : ""}`}
          >
            {index + 1}
          </a>
        );
      })}
    </nav>
  );
}

function SubmitBar({ answered, total, onSubmit }: { answered: number; total: number; onSubmit: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface p-4">
      <span className="text-body-sm text-fg-secondary">
        {answered} of {total} answered
      </span>
      <Button onClick={onSubmit}>Finish section</Button>
    </div>
  );
}

type QuestionSectionProps = {
  section: MockSection;
  answers: Answers;
  onAnswer: (next: Answers) => void;
  onSubmit: () => void;
  answered: number;
  total: number;
};

function ReadingSection({ section, answers, onAnswer, onSubmit, answered, total }: QuestionSectionProps) {
  const questions = section.questions ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <article className="rounded-xl border bg-surface p-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
        <h2 className="mb-3 text-h3">{section.passage?.title}</h2>
        <div className="grid gap-3 text-body leading-relaxed">
          {section.passage?.paragraphs.map((p, i) => (
            <p key={i}>
              <span className="mr-1.5 font-semibold text-fg-muted">{String.fromCharCode(65 + i)}</span>
              {p}
            </p>
          ))}
        </div>
      </article>
      <div className="grid content-start gap-4">
        <QuestionNavigator questions={questions} answers={answers} />
        <QuestionList questions={questions} answers={answers} onAnswer={onAnswer} />
        <SubmitBar answered={answered} total={total} onSubmit={onSubmit} />
      </div>
    </div>
  );
}

/**
 * The recording plays once, from the start, with no pause or rewind. UI only: the bar runs
 * for the recording's length so the screen can be judged; the audio itself comes later.
 */
function ListeningSection({ section, answers, onAnswer, onSubmit, answered, total }: QuestionSectionProps) {
  const length = section.audioSeconds ?? 120;
  const [state, setState] = useState<"ready" | "playing" | "finished">("ready");
  const left = useCountdown(length, state === "playing");
  if (state === "playing" && left <= 0) setState("finished");
  const questions = section.questions ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div className="sticky top-16 z-[5] rounded-xl border bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            size="icon"
            className="rounded-full"
            onClick={() => setState("playing")}
            disabled={state !== "ready"}
            aria-label={state === "ready" ? "Play the recording" : state === "playing" ? "Playing" : "Recording finished"}
          >
            {state === "finished" ? <CheckCircle2 aria-hidden /> : <Play aria-hidden />}
          </Button>
          <div className="grid min-w-0 flex-1 gap-1.5">
            <div className="flex items-center justify-between text-caption text-fg-muted">
              <span>
                {state === "ready" ? "Read the questions, then press Play — it plays once" : state === "playing" ? "Playing…" : "The recording has finished"}
              </span>
              <span className="font-mono tabular-nums">
                {mmss(length - left)} / {mmss(length)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-active" aria-hidden>
              <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear" style={{ width: `${((length - left) / length) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
      <QuestionNavigator questions={questions} answers={answers} />
      <QuestionList questions={questions} answers={answers} onAnswer={onAnswer} />
      <SubmitBar answered={answered} total={total} onSubmit={onSubmit} />
    </div>
  );
}

function WritingSection({
  section,
  essay,
  onChange,
  onSubmit,
}: {
  section: MockSection;
  essay: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
}) {
  const words = wordCount(essay);
  const min = section.task?.minWords ?? 0;
  const [blocked, setBlocked] = useState(false);
  // Copy, cut, paste and drop are refused: the essay has to be written here.
  const refuse = (event: ClipboardEvent | DragEvent) => {
    event.preventDefault();
    setBlocked(true);
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div className="rounded-xl border bg-surface p-5">
        <p className="mb-1 text-label text-fg-muted">Task</p>
        <p className="text-body leading-relaxed">{section.task?.prompt}</p>
        <p className="mt-3 text-caption text-fg-muted">Write at least {min} words.</p>
      </div>
      <div className="grid gap-2">
        <Textarea
          aria-label="Your answer"
          value={essay}
          onChange={(e) => onChange(e.target.value)}
          onPaste={refuse}
          onCopy={refuse}
          onCut={refuse}
          onDrop={refuse}
          onContextMenu={(e) => e.preventDefault()}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-[24rem] resize-y text-body leading-relaxed"
          placeholder="Start writing here…"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-caption">
          <span className={cn("tabular-nums", words >= min ? "text-success" : "text-fg-muted")}>
            {words} words{words < min && ` · ${min - words} to go`}
          </span>
          {blocked && <span className="text-warning-foreground">Copy and paste are turned off in the exam.</span>}
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={onSubmit}>Hand in my essay</Button>
      </div>
    </div>
  );
}

/**
 * The long turn: read the card, prepare, then record. UI only — the recording is simulated
 * with a timer and an animated level meter; the microphone comes with the backend.
 */
function SpeakingSection({ section, onSubmit }: { section: MockSection; onSubmit: () => void }) {
  const card = section.cueCard!;
  const [stage, setStage] = useState<"card" | "preparing" | "recording" | "recorded">("card");
  const prepLeft = useCountdown(card.prepSeconds, stage === "preparing");
  const speakLeft = useCountdown(card.speakSeconds, stage === "recording");
  if (stage === "preparing" && prepLeft <= 0) setStage("recording");
  if (stage === "recording" && speakLeft <= 0) setStage("recorded");
  const notes = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div className="rounded-xl border bg-surface p-6">
        <p className="mb-2 text-label text-fg-muted">Cue card</p>
        <p className="text-h3">{card.topic}</p>
        <p className="mt-4 text-body-sm text-fg-secondary">You should say:</p>
        <ul className="mt-1.5 grid gap-1 text-body">
          {card.points.map((point) => (
            <li key={point}>• {point}</li>
          ))}
        </ul>
      </div>

      {stage === "card" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface p-4">
          <span className="text-body-sm text-fg-secondary">
            You have {card.prepSeconds / 60} minute to prepare, then {card.speakSeconds / 60} minutes to speak.
          </span>
          <Button onClick={() => setStage("preparing")}>Start preparing</Button>
        </div>
      )}

      {stage === "preparing" && (
        <div className="grid gap-3 rounded-xl border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-body-sm font-medium">Preparation</span>
            <span className="font-mono text-h4 tabular-nums">{mmss(prepLeft)}</span>
          </div>
          <Textarea ref={notes} aria-label="Notes" placeholder="Notes — only for you, they are not marked" className="min-h-28" />
          <div className="flex justify-end">
            <Button onClick={() => setStage("recording")}>
              <Mic aria-hidden /> I&apos;m ready — record
            </Button>
          </div>
        </div>
      )}

      {stage === "recording" && (
        <div className="grid justify-items-center gap-4 rounded-xl border border-error/40 bg-surface p-6 text-center">
          <span className="relative grid size-16 place-items-center rounded-full bg-error text-error-foreground">
            <span className="absolute inset-0 animate-ping rounded-full bg-error/40 [animation-duration:1.6s]" aria-hidden />
            <Mic className="relative size-7" aria-hidden />
          </span>
          <div className="flex h-8 items-end gap-1" aria-hidden>
            {Array.from({ length: 24 }, (_, i) => (
              <span
                key={i}
                className="w-1 animate-pulse rounded-full bg-error/70"
                style={{ height: `${20 + ((i * 37) % 80)}%`, animationDelay: `${(i % 6) * 120}ms` }}
              />
            ))}
          </div>
          <p className="text-body-sm text-fg-secondary">
            Recording · <span className="font-mono tabular-nums text-foreground">{mmss(speakLeft)}</span> left
          </p>
          <Button variant="outline" onClick={() => setStage("recorded")}>
            <Square aria-hidden /> Stop recording
          </Button>
        </div>
      )}

      {stage === "recorded" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface p-4">
          <span className="flex items-center gap-2 text-body-sm">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> Your answer is recorded.
          </span>
          <Button onClick={onSubmit}>Finish section</Button>
        </div>
      )}
    </div>
  );
}

function Done({ skill, timeUp, summary }: { skill: MockSkill; timeUp: boolean; summary: string }) {
  return (
    <div className="mx-auto grid max-w-lg justify-items-center gap-4 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-success/15 text-success">
        <CheckCircle2 className="size-7" aria-hidden />
      </span>
      <h1 className="text-h2">{timeUp ? "Time is up" : `${mockSkillLabels[skill]} handed in`}</h1>
      <p className="text-body text-fg-secondary">{summary}.</p>
      <p className="rounded-lg border border-dashed px-4 py-3 text-body-sm text-fg-muted">
        Marking is not connected yet — your results will appear here once it is.
      </p>
      <Button asChild>
        <Link href="/app/mock-exam">Back to Mock exam</Link>
      </Button>
    </div>
  );
}
