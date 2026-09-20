"use client";

import { GripVertical, X } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { GrammarQuestion, GrammarResponse } from "@engora/types";

/**
 * One form per question type.
 *
 * They all answer the same question — "what did the learner say?" — and hand back the same
 * GrammarResponse, so the session around them never branches on type. Every one of them
 * works with a keyboard and on a touch screen; the ordering question in particular avoids
 * drag-and-drop for that reason, using tap-to-place instead.
 */

export interface QuestionFormProps {
  question: GrammarQuestion;
  value: GrammarResponse;
  onChange: (response: GrammarResponse) => void;
  onSubmit: () => void;
  disabled: boolean;
  /** Set once the answer is marked, to show which option was right. */
  expected?: string;
  correct?: boolean | null;
}

export function QuestionForm(props: QuestionFormProps) {
  switch (props.question.type) {
    case "multiple_choice":
    case "contextual":
      return <ChoiceForm {...props} />;
    case "ordering":
      return <OrderingForm {...props} />;
    case "matching":
      return <MatchingForm {...props} />;
    case "free_writing":
      return <WritingForm {...props} />;
    default:
      return <TextForm {...props} />;
  }
}

function ChoiceForm({ question, value, onChange, disabled, expected, correct }: QuestionFormProps) {
  const options = question.payload.options ?? [];
  return (
    <div role="radiogroup" aria-label={question.prompt} className="grid gap-2">
      {options.map((option, i) => {
        const picked = value.index === i;
        const isExpected = disabled && expected === option;
        const wrongPick = disabled && picked && correct === false;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={picked}
            disabled={disabled}
            onClick={() => onChange({ index: i })}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-body transition-colors duration-micro outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default",
              !disabled && "hover:bg-surface-hover",
              picked && !disabled && "border-primary bg-primary-subtle text-primary-subtle-foreground",
              isExpected && "border-success bg-success/10",
              wrongPick && "border-error bg-error/10",
              !picked && !isExpected && "bg-surface",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border text-caption",
                picked ? "border-current" : "border-border text-fg-muted",
              )}
            >
              {String.fromCharCode(65 + i)}
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

function TextForm({ question, value, onChange, onSubmit, disabled, expected, correct }: QuestionFormProps) {
  const { sentence, instruction, hint } = question.payload;
  return (
    <div className="grid gap-3">
      {sentence && (
        <p className="rounded-xl border bg-surface px-4 py-3 text-body">
          {sentence}
        </p>
      )}
      {instruction && <p className="text-body-sm text-fg-muted">{instruction}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) onSubmit();
        }}
      >
        <Input
          autoFocus
          value={value.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          disabled={disabled}
          placeholder={hint ? `${hint} →` : "Your answer"}
          aria-label="Your answer"
          className={cn(
            "h-12 text-body",
            disabled && correct === true && "border-success",
            disabled && correct === false && "border-error",
          )}
        />
      </form>
      {disabled && correct === false && expected && (
        <p className="text-body-sm">
          <span className="text-fg-muted">Correct answer: </span>
          <span className="font-medium">{expected}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Sentence ordering by tapping, not dragging. Drag-and-drop is hostile on a phone and
 * unreachable with a keyboard; tapping a word to add it and tapping it again to take it
 * back works identically everywhere.
 */
function OrderingForm({ question, value, onChange, disabled }: QuestionFormProps) {
  const segments = question.payload.segments ?? [];
  const chosen = value.order ?? [];

  // Positions rather than words, so a sentence containing the same word twice behaves
  // correctly. The session remounts this form per question, so it starts empty each time.
  const [used, setUsed] = useState<number[]>([]);

  const place = (i: number) => {
    if (disabled || used.includes(i)) return;
    const next = [...used, i];
    setUsed(next);
    onChange({ order: next.map((n) => segments[n]!) });
  };
  const remove = (position: number) => {
    if (disabled) return;
    const next = used.filter((_, idx) => idx !== position);
    setUsed(next);
    onChange({ order: next.map((n) => segments[n]!) });
  };

  return (
    <div className="grid gap-3">
      <div
        aria-live="polite"
        className="flex min-h-14 flex-wrap items-start gap-2 rounded-xl border border-dashed bg-surface p-3"
      >
        {chosen.length === 0 ? (
          <p className="self-center text-body-sm text-fg-muted">Tap the words below to build the sentence.</p>
        ) : (
          used.map((segmentIndex, position) => (
            <button
              key={`${segmentIndex}-${position}`}
              type="button"
              disabled={disabled}
              onClick={() => remove(position)}
              aria-label={`Remove ${segments[segmentIndex]}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-primary-subtle px-2.5 py-1.5 text-body-sm text-primary-subtle-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default"
            >
              {segments[segmentIndex]}
              {!disabled && <X className="size-3" aria-hidden />}
            </button>
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {segments.map((segment, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled || used.includes(i)}
            onClick={() => place(i)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-1.5 text-body-sm outline-none transition-colors duration-micro",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              used.includes(i) ? "opacity-30" : "hover:bg-surface-hover",
            )}
          >
            <GripVertical className="size-3 text-fg-muted" aria-hidden />
            {segment}
          </button>
        ))}
      </div>
    </div>
  );
}

function MatchingForm({ question, value, onChange, disabled }: QuestionFormProps) {
  const left = question.payload.left ?? [];
  const right = question.payload.right ?? [];
  const pairs = value.pairs ?? {};

  return (
    <div className="grid gap-2">
      {left.map((item, i) => (
        <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-4 py-3">
          <span className="min-w-24 text-body font-medium">{item}</span>
          <div role="radiogroup" aria-label={`Match for ${item}`} className="flex flex-wrap gap-1.5">
            {right.map((option, j) => {
              const picked = pairs[String(i)] === j;
              return (
                <button
                  key={j}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={disabled}
                  onClick={() => onChange({ pairs: { ...pairs, [String(i)]: j } })}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-body-sm outline-none transition-colors duration-micro",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default",
                    picked ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "hover:bg-surface-hover",
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function WritingForm({ question, value, onChange, disabled }: QuestionFormProps) {
  const { instruction, min_words: min = 0, max_words: max } = question.payload;
  const words = (value.text ?? "").trim().split(/\s+/).filter(Boolean).length;
  const short = min > 0 && words < min;

  return (
    <div className="grid gap-2">
      {instruction && <p className="text-body-sm text-fg-muted">{instruction}</p>}
      <Textarea
        autoFocus
        rows={6}
        value={value.text ?? ""}
        onChange={(e) => onChange({ text: e.target.value })}
        disabled={disabled}
        placeholder="Write your answer…"
        aria-label="Your answer"
        aria-describedby="word-count"
      />
      <p id="word-count" className="text-caption text-fg-muted">
        {words} {words === 1 ? "word" : "words"}
        {min > 0 && ` · at least ${min}`}
        {max ? ` · up to ${max}` : ""}
        {short && words > 0 && " — keep going"}
      </p>
    </div>
  );
}

/** Whether there is enough of an answer to submit. */
export function hasAnswer(question: GrammarQuestion, response: GrammarResponse): boolean {
  switch (question.type) {
    case "multiple_choice":
    case "contextual":
      return response.index !== undefined;
    case "ordering":
      return (response.order?.length ?? 0) === (question.payload.segments?.length ?? 0);
    case "matching":
      return Object.keys(response.pairs ?? {}).length === (question.payload.left?.length ?? 0);
    case "free_writing": {
      const words = (response.text ?? "").trim().split(/\s+/).filter(Boolean).length;
      return words >= (question.payload.min_words ?? 1);
    }
    default:
      return (response.text ?? "").trim().length > 0;
  }
}
