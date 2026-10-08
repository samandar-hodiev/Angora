import { Check, Lightbulb, X, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

/**
 * The building blocks of a grammar lesson, shared by the curated rule and the AI explanation so
 * both read the same way. Each kind of block has its own tone (see `.lesson-block` in
 * globals.css): the rule is blue, the form violet, examples green, mistakes red, exceptions
 * orange, tips yellow — a learner can tell what a block is before reading a word of it.
 */

export type LessonTone = "rule" | "formula" | "example" | "usage" | "mistake" | "exception" | "tip";

export function LessonSection({
  id,
  title,
  tone,
  icon: Icon,
  count,
  children,
}: {
  id: string;
  title: string;
  tone: LessonTone;
  icon: LucideIcon;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-tone={tone} className="grid scroll-mt-28 gap-3">
      <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-h3">
        <span className="lesson-chip grid size-8 place-items-center rounded-lg">
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
        {count !== undefined && count > 1 && (
          <span className="lesson-chip rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums">{count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

/**
 * Text with the phrases being taught picked out: anything 'in single quotes' or **in bold** is
 * shown as a highlighted phrase. Apostrophes inside words (don't, it's) are left alone.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|(?<![\p{L}])'[^'\n]{2,60}'(?![\p{L}]))/u);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.length > 2 && part.startsWith("'") && part.endsWith("'")) {
          return (
            <mark key={i} className="lesson-chip rounded px-1 py-px font-medium">
              {part.slice(1, -1)}
            </mark>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </span>
  );
}

/** Which way a formula goes, from its label in any of the three languages. */
function formulaKind(label: string): { tone: "positive" | "negative" | "question" | "formula"; badge: string } {
  const l = label.toLowerCase();
  if (/negativ|salbiy|отрица|inkor/.test(l)) return { tone: "negative", badge: "−" };
  if (/question|savol|вопрос|so'roq|so‘roq/.test(l)) return { tone: "question", badge: "?" };
  if (/affirm|positive|ijobiy|утверд|darak/.test(l)) return { tone: "positive", badge: "+" };
  return { tone: "formula", badge: "=" };
}

/** A label without the example the writer squeezed into it — the example has its own line. */
function cleanLabel(label: string) {
  let out = label.replace(/\s*\((masalan|e\.g\.|for example|example|например)[^)]*\)\s*/gi, " ");
  // "Positive: subject + be + …" repeats the pattern shown right under it; keep the name.
  const colon = out.indexOf(":");
  if (colon > 0 && out.slice(colon).includes("+")) out = out.slice(0, colon);
  return out.replace(/:\s*$/, "").trim();
}

/** "subject + be + used to + verb-ing" as a row of parts, so the structure reads at a glance. */
function Pattern({ pattern }: { pattern: string }) {
  const pieces = pattern.split(/\s+\+\s+/);
  return (
    <p className="flex flex-wrap items-center gap-1.5 font-mono text-body">
      {pieces.map((piece, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="text-fg-muted">
              +
            </span>
          )}
          <span className="rounded-md bg-background/70 px-2 py-0.5 ring-1 ring-border">{piece}</span>
        </Fragment>
      ))}
      <span className="sr-only">{pattern}</span>
    </p>
  );
}

export function FormulaList({ formulas }: { formulas: { label: string; pattern: string; examples?: string[] }[] }) {
  return (
    <ol className="grid gap-2.5">
      {formulas.map((f, i) => {
        const kind = formulaKind(f.label);
        return (
          <li key={i} data-tone={kind.tone} className="lesson-block grid gap-2.5 rounded-xl px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span aria-hidden className="lesson-chip grid size-6 place-items-center rounded-md text-body-sm font-bold">
                {kind.badge}
              </span>
              <span className="lesson-tone-text text-label font-semibold">{cleanLabel(f.label)}</span>
            </div>
            <Pattern pattern={f.pattern} />
            {f.examples && f.examples.length > 0 && (
              <ul className="grid gap-1 border-t border-border/60 pt-2">
                {f.examples.map((e, j) => (
                  <li key={j} className="text-body-sm text-fg-secondary">
                    <RichText text={e} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function UsageList({ items }: { items: { use: string; example?: string }[] }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2">
      {items.map((item, i) => (
        <li key={i} data-tone="usage" className="lesson-block flex gap-3 rounded-xl px-4 py-3">
          <span className="lesson-chip grid size-6 shrink-0 place-items-center rounded-full text-caption font-bold tabular-nums">
            {i + 1}
          </span>
          <span className="grid gap-1">
            <RichText text={item.use} className="text-body" />
            {item.example && <span className="text-body-sm text-fg-secondary italic">{item.example}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ExampleList({ items }: { items: { text: string; note?: string }[] }) {
  return (
    <ul data-tone="example" className="lesson-block divide-y divide-border/60 rounded-xl">
      {items.map((e, i) => (
        <li key={i} className="grid gap-0.5 px-4 py-3">
          <RichText text={e.text} className="text-body font-medium" />
          {e.note && <RichText text={e.note} className="text-body-sm text-fg-secondary" />}
        </li>
      ))}
    </ul>
  );
}

/** Positive, negative and question sentences side by side, each column in its own tone. */
export function ExampleColumns({ positive, negative, questions }: { positive: string[]; negative: string[]; questions: string[] }) {
  const columns = [
    ["positive", "Positive", "+", positive],
    ["negative", "Negative", "−", negative],
    ["question", "Questions", "?", questions],
  ] as const;
  if (columns.every(([, , , items]) => items.length === 0)) return null;
  return (
    <div className="grid gap-2.5 md:grid-cols-3">
      {columns.map(([tone, title, badge, items]) =>
        items.length ? (
          <div key={tone} data-tone={tone} className="lesson-block grid content-start gap-2 rounded-xl px-4 py-3">
            <p className="flex items-center gap-2">
              <span aria-hidden className="lesson-chip grid size-5 place-items-center rounded text-caption font-bold">
                {badge}
              </span>
              <span className="lesson-tone-text text-label font-semibold">{title}</span>
            </p>
            <ul className="grid gap-1">
              {items.map((item, i) => (
                <li key={i} className="text-body-sm">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Where the topic breaks its own rule — set apart in orange so it is not read as the rule. */
export function ExceptionList({ items }: { items: { rule: string; examples: string[] }[] }) {
  return (
    <ul className="grid gap-2.5">
      {items.map((item, i) => (
        <li key={i} data-tone="exception" className="lesson-block grid gap-2 rounded-xl px-4 py-3">
          <p className="flex items-start gap-2.5">
            <span className="lesson-chip mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-bold tracking-wide uppercase">
              Exception
            </span>
            <RichText text={item.rule} className="text-body" />
          </p>
          {item.examples.length > 0 && (
            <ul className="grid gap-0.5 pl-1">
              {item.examples.map((example, j) => (
                <li key={j} className="text-body-sm text-fg-secondary italic">
                  {example}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MistakeList({ items }: { items: { wrong: string; right: string; why: string }[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((m, i) => (
        <li key={i} className="grid content-start gap-2 rounded-xl border bg-background/40 p-3">
          <p data-tone="mistake" className="lesson-block flex items-start gap-2 rounded-lg px-3 py-2">
            <X className="lesson-tone-text mt-1 size-4 shrink-0" aria-label="Wrong" />
            <span className="text-body text-fg-secondary line-through decoration-1">{m.wrong}</span>
          </p>
          <p data-tone="right" className="lesson-block flex items-start gap-2 rounded-lg px-3 py-2">
            <Check className="lesson-tone-text mt-1 size-4 shrink-0" aria-label="Right" />
            <span className="text-body font-medium">{m.right}</span>
          </p>
          <RichText text={m.why} className="px-1 text-body-sm text-fg-secondary" />
        </li>
      ))}
    </ul>
  );
}

export function TipList({ items }: { items: string[] }) {
  return (
    <ul data-tone="tip" className="lesson-block grid gap-2 rounded-xl px-4 py-3">
      {items.map((tip, i) => (
        <li key={i} className="flex items-start gap-2.5 text-body">
          <Lightbulb className="lesson-tone-text mt-1 size-4 shrink-0" aria-hidden />
          <RichText text={tip} />
        </li>
      ))}
    </ul>
  );
}

export function SignalWords({ words }: { words: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {words.map((word) => (
        <li key={word} data-tone="rule" className="lesson-chip rounded-full px-3 py-1 text-body-sm font-medium">
          {word}
        </li>
      ))}
    </ul>
  );
}

/**
 * The tutor's answers, which arrive as light Markdown: paragraphs, "- " lists and **bold**.
 * Rendered rather than shown raw, so a learner sees emphasis instead of asterisks.
 */
export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="grid gap-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="grid gap-1 pl-1">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  <RichText text={l.replace(/^\s*([-*•]|\d+\.)\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <RichText text={l} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

