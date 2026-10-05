"use client";

import { ArrowLeftRight, BookOpen, Check, Lightbulb, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { FlagRU, FlagUZ } from "@/components/common/flags";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ComparisonResponse, WordComparison } from "@engora/types";

import { useCompareWords } from "../../hooks";
import { Chip, SpeakButton } from "./shared";

/** Pairs learners from Uzbek and Russian most often mix up, to start from. */
const POPULAR: string[][] = [
  ["job", "occupation", "profession"],
  ["make", "do"],
  ["say", "tell", "speak"],
  ["borrow", "lend"],
  ["look", "see", "watch"],
  ["fun", "funny"],
  ["house", "home"],
  ["affect", "effect"],
  ["rob", "steal"],
  ["remember", "remind"],
  ["travel", "trip", "journey"],
  ["big", "large", "huge"],
];

const RECENT_KEY = "engora.vocabulary.recent-comparisons";

function readRecent(): string[][] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[][]).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberRecent(terms: string[]) {
  try {
    const key = terms.join("|");
    const next = [terms, ...readRecent().filter((t) => t.join("|") !== key)].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A browser that keeps nothing simply shows no recent comparisons.
  }
}

/**
 * "Job and occupation are both kasb — so what is the difference?" The learner types two or
 * three words and gets the difference, when to use each, the same told in Uzbek and Russian,
 * and a short quiz to check it stuck.
 */
export function ComparePanel({
  initial,
  onOpenWord,
}: {
  /** Words handed over from a word's page, compared as soon as the panel opens. */
  initial: string[] | null;
  onOpenWord: (id: string) => void;
}) {
  const [terms, setTerms] = useState<string[]>(() => (initial && initial.length >= 2 ? initial : ["", ""]));
  // The tab is only drawn after a click, never on the server, so storage can be read at once.
  const [recent, setRecent] = useState<string[][]>(readRecent);
  const compare = useCompareWords();

  const run = (words: string[]) => {
    const clean = words.map((w) => w.trim()).filter(Boolean);
    if (clean.length < 2) return;
    setTerms(clean);
    compare.mutate(clean, {
      onSuccess: (res) => {
        rememberRecent(res.terms);
        setRecent(readRecent());
      },
    });
  };

  // Words handed over from a word's page are compared straight away. The panel is keyed by
  // them, so each hand-over mounts it afresh and this runs once.
  const { mutate } = compare;
  useEffect(() => {
    if (initial && initial.length >= 2) {
      mutate(initial, {
        onSuccess: (res) => {
          rememberRecent(res.terms);
          setRecent(readRecent());
        },
      });
    }
  }, [initial, mutate]);

  const filled = terms.filter((t) => t.trim()).length;

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(terms);
        }}
      >
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 text-h4">
            <ArrowLeftRight className="size-4 text-primary" aria-hidden /> Compare words
          </h2>
          <p className="text-body-sm text-fg-secondary">
            Two words that mean the same in Uzbek or Russian? See exactly how they differ and when to use each.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {terms.map((term, i) => (
            <div key={i} className="flex flex-1 items-center gap-2">
              {i > 0 && <span className="hidden text-label text-fg-muted sm:inline">vs</span>}
              <div className="relative flex-1">
                <Input
                  value={term}
                  onChange={(e) => setTerms(terms.map((t, j) => (j === i ? e.target.value : t)))}
                  placeholder={["job", "occupation", "profession"][i]}
                  aria-label={`Word ${i + 1}`}
                  maxLength={40}
                  className="h-10 pr-8"
                />
                {i === 2 && (
                  <button
                    type="button"
                    aria-label="Remove the third word"
                    onClick={() => setTerms(terms.slice(0, 2))}
                    className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-muted hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            {terms.length < 3 && (
              <Button type="button" variant="outline" onClick={() => setTerms([...terms, ""])} aria-label="Add a third word">
                <Plus aria-hidden /> <span className="sm:hidden">Third word</span>
              </Button>
            )}
            <Button type="submit" disabled={filled < 2} loading={compare.isPending} className="flex-1 sm:flex-none">
              <Sparkles aria-hidden /> Compare
            </Button>
          </div>
        </div>
        <div className="grid gap-2">
          <p className="text-caption text-fg-muted">Often confused</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {POPULAR.map((set) => (
              <Chip key={set.join("|")} onClick={() => run(set)}>
                {set.join(" · ")}
              </Chip>
            ))}
          </div>
        </div>
        {recent.length > 0 && (
          <div className="grid gap-2">
            <p className="text-caption text-fg-muted">Your recent comparisons</p>
            <div className="flex flex-wrap gap-2">
              {recent.map((set) => (
                <Chip key={set.join("|")} onClick={() => run(set)}>
                  <RotateCcw className="size-3" aria-hidden />
                  {set.join(" vs ")}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </form>

      {compare.isPending ? (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="h-24 rounded-xl" />
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
          <p className="text-caption text-fg-muted">Working out the difference…</p>
        </div>
      ) : compare.isError ? (
        <ErrorState error={compare.error} onRetry={() => run(terms)} />
      ) : compare.data ? (
        <ComparisonResult key={compare.data.terms.join("|")} result={compare.data} onOpenWord={onOpenWord} />
      ) : null}
    </div>
  );
}

const INTERCHANGEABLE: Record<WordComparison["interchangeable"], { label: string; tone: string }> = {
  never: { label: "Not interchangeable", tone: "bg-error/15 text-error" },
  sometimes: {
    label: "Sometimes interchangeable",
    tone: "bg-warning/15 text-warning-text",
  },
  often: { label: "Often interchangeable", tone: "bg-success/15 text-success" },
};

function ComparisonResult({ result, onOpenWord }: { result: ComparisonResponse; onOpenWord: (id: string) => void }) {
  const c = result.comparison;
  const badge = INTERCHANGEABLE[c.interchangeable] ?? INTERCHANGEABLE.sometimes;
  return (
    <div className="grid gap-5">
      {/* The answer first. */}
      <section className="grid gap-3 rounded-xl border border-primary/40 bg-primary-subtle/30 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-h3">{result.terms.join(" vs ")}</h3>
          <span className={cn("rounded-full px-2.5 py-0.5 text-caption font-medium", badge.tone)}>{badge.label}</span>
          <span className="ml-auto text-caption text-fg-muted">Explained for {result.level}</span>
        </div>
        <p className="text-body-lg">{c.verdict}</p>
        {c.tip && (
          <p className="flex items-start gap-2 text-body-sm text-fg-secondary">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {c.tip}
          </p>
        )}
        {(c.native_note.uz || c.native_note.ru) && (
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-2">
            {c.native_note.uz && (
              <p className="flex items-start gap-2 text-body-sm">
                <FlagUZ title="O'zbekcha" className="mt-0.5" />
                {c.native_note.uz}
              </p>
            )}
            {c.native_note.ru && (
              <p className="flex items-start gap-2 text-body-sm">
                <FlagRU title="Русский" className="mt-0.5" />
                {c.native_note.ru}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Each word on its own. */}
      <div className={cn("grid gap-3", c.words.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {c.words.map((w) => {
          const id = result.library[w.term.toLowerCase()];
          return (
            <article key={w.term} className="grid content-start gap-3 rounded-xl border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-h4">{w.term}</h4>
                <SpeakButton text={w.term} />
                <span className="text-caption text-fg-muted">{w.part_of_speech}</span>
                {w.register && w.register !== "neutral" && (
                  <span className="rounded border px-1.5 py-px text-[0.6875rem] text-fg-secondary">{w.register}</span>
                )}
                {id && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpenWord(id)}>
                    <BookOpen aria-hidden /> Open
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
                {w.translations.uz && (
                  <span className="flex items-center gap-1.5">
                    <FlagUZ title="O'zbekcha" />
                    {w.translations.uz}
                  </span>
                )}
                {w.translations.ru && (
                  <span className="flex items-center gap-1.5">
                    <FlagRU title="Русский" />
                    {w.translations.ru}
                  </span>
                )}
              </div>
              <p className="text-body">{w.meaning}</p>
              {w.when_to_use && (
                <p className="text-body-sm text-fg-secondary">
                  <span className="font-medium text-foreground">Use it when: </span>
                  {w.when_to_use}
                </p>
              )}
              {w.collocations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {w.collocations.map((col) => (
                    <span key={col} className="rounded-full border px-2.5 py-0.5 text-caption text-fg-secondary">
                      {col}
                    </span>
                  ))}
                </div>
              )}
              {w.examples.map((ex) => (
                <p
                  key={ex}
                  className="flex items-start gap-2 border-l-2 border-primary/40 pl-3 text-body-sm text-fg-secondary italic"
                >
                  {ex}
                  <SpeakButton text={ex} className="ml-auto" />
                </p>
              ))}
            </article>
          );
        })}
      </div>

      {/* Side by side, aspect by aspect. */}
      {c.differences.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-h4">The differences</h3>
          <div className="overflow-x-auto rounded-xl border bg-surface">
            <table className="w-full min-w-[32rem] text-left text-body-sm">
              <thead>
                <tr className="border-b">
                  <th className="w-36 px-4 py-2.5 text-label text-fg-muted" />
                  {c.words.map((w) => (
                    <th key={w.term} className="px-4 py-2.5 text-label">
                      {w.term}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.differences.map((d) => (
                  <tr key={d.aspect} className="border-b align-top last:border-b-0">
                    <th scope="row" className="px-4 py-2.5 font-medium text-fg-secondary capitalize">
                      {d.aspect}
                    </th>
                    {d.points.map((point, i) => (
                      <td key={i} className="px-4 py-2.5">
                        {point}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {c.quiz.length > 0 && <Quiz quiz={c.quiz} words={c.words.map((w) => w.term)} />}
    </div>
  );
}

/** Fill the gap: each sentence takes exactly one of the words. */
function Quiz({ quiz, words }: { quiz: WordComparison["quiz"]; words: string[] }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const done = Object.keys(answers).length;
  const right = quiz.filter((q, i) => answers[i] === q.answer).length;
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-h4">Check yourself</h3>
        <span className="flex items-center gap-2 text-caption text-fg-muted tabular-nums">
          {done > 0 && `${right} / ${done} right`}
          {done > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setAnswers({})}>
              <RotateCcw aria-hidden /> Again
            </Button>
          )}
        </span>
      </div>
      <ol className="grid gap-2">
        {quiz.map((q, i) => {
          const picked = answers[i];
          const [before, after] = q.sentence.split("___");
          return (
            <li key={i} className="grid gap-2 rounded-xl border bg-surface p-4">
              <p className="text-body">
                <span className="mr-2 text-fg-muted tabular-nums">{i + 1}.</span>
                {before}
                <span
                  className={cn(
                    "mx-1 inline-block min-w-16 rounded border-b-2 px-1 text-center font-medium",
                    !picked && "border-fg-muted text-fg-muted",
                    picked && picked === q.answer && "border-success text-success",
                    picked && picked !== q.answer && "border-error text-error",
                  )}
                >
                  {picked ?? "…"}
                </span>
                {after}
              </p>
              <div className="flex flex-wrap gap-2">
                {words.map((w) => (
                  <Button
                    key={w}
                    size="sm"
                    variant={
                      picked === w ? (w === q.answer ? "subtle" : "destructive") : picked && w === q.answer ? "subtle" : "outline"
                    }
                    aria-disabled={!!picked}
                    onClick={() => !picked && setAnswers({ ...answers, [i]: w })}
                  >
                    {picked && w === q.answer && <Check aria-hidden />}
                    {w}
                  </Button>
                ))}
              </div>
              {picked && <p className="text-body-sm text-fg-secondary">{q.explanation}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
