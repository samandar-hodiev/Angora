"use client";

import type { ChoiceQuestion } from "@engora/types";

import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/choice";

/** Multiple-choice questions. Answers are checked by the API when attempts are submitted. */
export function QuestionList({
  questions,
  answers,
  onAnswer,
}: {
  questions: ChoiceQuestion[];
  answers: Record<string, string>;
  onAnswer: (questionId: string, option: string) => void;
}) {
  return (
    <ol className="grid gap-6">
      {questions.map((q, i) => (
        <li key={q.id} className="grid gap-3">
          <p id={`${q.id}-label`} className="text-h4">
            <span className="mr-2 text-fg-muted tabular-nums">{i + 1}.</span>
            {q.prompt}
          </p>
          <RadioGroup aria-labelledby={`${q.id}-label`} value={answers[q.id] ?? ""} onValueChange={(v) => onAnswer(q.id, v)} className="gap-2">
            {q.options.map((option, oi) => {
              const id = `${q.id}-${oi}`;
              return (
                <Label
                  key={id}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-3.5 py-3 font-normal transition-colors duration-micro hover:bg-surface-hover has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-subtle"
                >
                  <Radio id={id} value={option} />
                  <span className="text-caption font-medium text-fg-muted">{String.fromCharCode(65 + oi)}</span>
                  <span className="text-body-sm">{option}</span>
                </Label>
              );
            })}
          </RadioGroup>
        </li>
      ))}
    </ol>
  );
}
