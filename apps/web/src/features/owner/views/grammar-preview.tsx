"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";

/**
 * What the learner will see.
 *
 * A rehearsal of the learner topic page (features/grammar/components/topic-view) rendered
 * from the draft being edited, so publishing never produces a surprise. It reads the same
 * body shape the learner app reads, and renders nothing interactive.
 */

interface Formula {
  label?: string;
  pattern?: string;
  examples?: string[];
}

interface Mistake {
  wrong?: string;
  right?: string;
  why?: string;
}

interface Example {
  text?: string;
  note?: string;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function GrammarLearnerPreview({
  name,
  level,
  category,
  minutes,
  ielts,
  questionCount,
  body,
}: {
  name: string;
  level: string | null;
  category: string | null;
  minutes: number;
  ielts: boolean;
  questionCount: number;
  body: Record<string, unknown>;
}) {
  const intro = typeof body.intro === "string" ? body.intro : "";
  const explanation = typeof body.explanation === "string" ? body.explanation : "";
  const formulas = asArray<Formula>(body.formulas);
  const usage = asArray<string>(body.usage);
  const signalWords = asArray<string>(body.signal_words);
  const examples = asArray<Example>(body.examples);
  const mistakes = asArray<Mistake>(body.common_mistakes);

  const empty = !intro && !explanation && formulas.length === 0 && examples.length === 0;

  if (empty) {
    return (
      <div className="rounded-xl border border-dashed bg-surface p-8 text-center">
        <p className="text-h4">Nothing to preview yet</p>
        <p className="mt-1 text-body-sm text-fg-secondary">
          Write the explanation in the editor and it will appear here exactly as learners will read it.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background p-5 sm:p-8">
      <p className="mb-4 text-caption text-fg-muted">Learner view</p>

      <article className="grid max-w-3xl gap-8">
        <header className="grid gap-2">
          <h1 className="text-h1">{name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
            {level && <Badge variant="outline">{level}</Badge>}
            {category && <span>{category}</span>}
            <span aria-hidden>·</span>
            <span>{minutes} min</span>
            {ielts && <Badge variant="secondary">IELTS</Badge>}
          </p>
        </header>

        {(intro || explanation) && (
          <section className="grid gap-3">
            <h2 className="text-h3">What is {name}?</h2>
            {intro && <p className="text-body-lg text-fg-secondary">{intro}</p>}
            {explanation.split("\n\n").filter(Boolean).map((paragraph, index) => (
              <p key={index} className="text-body">
                {paragraph}
              </p>
            ))}
          </section>
        )}

        {formulas.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Form</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {formulas.map((formula, index) => (
                <div key={index} className="grid gap-1.5 rounded-xl border bg-surface p-4">
                  <p className="text-label text-fg-muted">{formula.label}</p>
                  <p className="font-mono text-body-sm">{formula.pattern}</p>
                  {asArray<string>(formula.examples).length > 0 && (
                    <ul className="grid gap-0.5 border-t pt-2">
                      {asArray<string>(formula.examples).map((example, i) => (
                        <li key={i} className="text-body-sm text-fg-secondary">
                          {example}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {usage.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">When do we use it?</h2>
            <ul className="grid gap-2">
              {usage.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-body">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {signalWords.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Signal words</h2>
            <ul className="flex flex-wrap gap-2">
              {signalWords.map((word) => (
                <li key={word}>
                  <Badge variant="outline" className="px-2.5 py-1 text-body-sm">
                    {word}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        {examples.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Examples</h2>
            <ul className="divide-y rounded-xl border bg-surface">
              {examples.map((example, index) => (
                <li key={index} className="grid gap-0.5 px-4 py-3">
                  <p className="text-body">{example.text}</p>
                  {example.note && <p className="text-caption text-fg-muted">{example.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {mistakes.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Common mistakes</h2>
            <ul className="grid gap-2">
              {mistakes.map((mistake, index) => (
                <li key={index} className="grid gap-1 rounded-xl border bg-surface p-4 text-body-sm">
                  <p>
                    <span className="text-error line-through">{mistake.wrong}</span>
                    {" → "}
                    <span className="text-success">{mistake.right}</span>
                  </p>
                  {mistake.why && <p className="text-caption text-fg-muted">{mistake.why}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-3 rounded-xl border bg-surface p-5">
          <h2 className="text-h3">Practice</h2>
          <p className="text-body-sm text-fg-secondary">
            {questionCount > 0
              ? `${questionCount} questions. Answers are marked instantly and weak points are tracked.`
              : "No practice questions on this topic yet."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled>Practise this topic</Button>
          </div>
          <p className="text-caption text-fg-muted">Practice is disabled inside the preview.</p>
        </section>

        <section className="grid gap-3">
          <h2 className="text-h3">Your progress</h2>
          <div className="grid gap-3 rounded-xl border bg-surface p-4">
            <Meter label="Mastery" value={0} display="Not started" />
            <p className="text-caption text-fg-muted">Each learner sees their own mastery and attempts here.</p>
          </div>
        </section>
      </article>
    </div>
  );
}
