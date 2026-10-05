"use client";

import { ArrowLeftRight, BookOpen, GitBranch, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { FlagUZ } from "@/components/common/flags";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LadderResponse } from "@engora/types";

import { useLadder } from "../../hooks";
import { Chip, LEVEL_NAMES, LevelTag, RegisterTag, SpeakButton } from "./shared";

const STARTERS = ["big", "good", "bad", "happy", "say", "eat", "walk", "important", "problem", "angry", "small", "think"];

/**
 * Level ladder: one meaning of a word, and the word for it at each level — big, large, huge,
 * enormous, immense, colossal — drawn as a tree from the word to its levels, each explained in
 * Uzbek. It answers what a learner aiming for a higher band actually asks: what do I say
 * instead?
 */
export function LadderPanel({ onOpenWord, onCompare }: { onOpenWord: (id: string) => void; onCompare: (terms: string[]) => void }) {
  const [term, setTerm] = useState("");
  const ladder = useLadder();
  const resultRef = useRef<HTMLDivElement>(null);
  const run = (t: string) => {
    const clean = t.trim();
    if (!clean) return;
    setTerm(clean);
    ladder.mutate(clean);
    // Straight down to where the ladder is being built, so the learner watches it arrive.
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(term);
        }}
      >
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 text-h4">
            <GitBranch className="size-4 text-primary" aria-hidden /> Level ladder
          </h2>
          <p className="text-body-sm text-fg-secondary">
            Type a word and see the word for the same meaning at every level — the step from a simple word to the one a higher
            band asks for, explained in Uzbek.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="big"
            aria-label="Word"
            maxLength={40}
            className="h-10 flex-1"
          />
          <Button type="submit" disabled={!term.trim()} loading={ladder.isPending}>
            <Sparkles aria-hidden /> Build the ladder
          </Button>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {STARTERS.map((s) => (
            <Chip key={s} onClick={() => run(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </form>

      {/* Clear of the sticky app header when scrolled to. */}
      <div ref={resultRef} className="scroll-mt-24">
        {ladder.isPending ? (
          <div className="grid gap-3" aria-busy>
            <Skeleton className="h-14 rounded-xl" />
            <div className="grid gap-2 md:grid-cols-[8rem_4rem_minmax(0,1fr)]">
              <Skeleton className="hidden h-20 self-center rounded-xl md:block" />
              <span className="hidden md:block" />
              <div className="grid gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            </div>
            <p className="text-caption text-fg-muted">Climbing the levels…</p>
          </div>
        ) : ladder.isError ? (
          <ErrorState error={ladder.error} onRetry={() => run(term)} />
        ) : ladder.data ? (
          <LadderTree result={ladder.data} onOpenWord={onOpenWord} onCompare={onCompare} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The ladder as a tree: the word on the left, a curved branch to each level on the right. The
 * branches are an SVG drawn beside the level cards, one path per row, so the picture holds at
 * any width; on a phone the tree folds into a plain list.
 *
 * It is drawn to be seen whole: compact enough that the summary and all six levels fit a laptop
 * screen, with more air on a tall one.
 */
function LadderTree({
  result,
  onOpenWord,
  onCompare,
}: {
  result: LadderResponse;
  onOpenWord: (id: string) => void;
  onCompare: (terms: string[]) => void;
}) {
  const { ladder } = result;
  const rows = ladder.rungs.length;
  const used = ladder.rungs.filter((r) => r.term).map((r) => r.term);
  return (
    <section className="grid gap-3 tall:gap-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-xl border border-primary/40 bg-primary-subtle/30 px-4 py-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="flex items-center gap-2 text-body font-medium">
            <FlagUZ title="O'zbekcha" />
            {ladder.meaning_uz}
          </p>
          {ladder.summary_uz && <p className="text-body-sm text-fg-secondary">{ladder.summary_uz}</p>}
        </div>
        {used.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => onCompare(used.slice(0, 3))}>
            <ArrowLeftRight aria-hidden /> Compare {used.slice(0, 3).join(" vs ")}
          </Button>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-[8rem_4rem_minmax(0,1fr)] tall:gap-3 tall:md:grid-cols-[10rem_6rem_minmax(0,1fr)]">
        {/* The root word, centred against the whole ladder. */}
        <div
          className="flex items-center md:col-start-1 md:row-[var(--rows)]"
          style={{ "--rows": `1 / span ${rows}` } as React.CSSProperties}
        >
          <div className="grid w-full justify-items-center gap-1 rounded-xl border-2 border-primary/60 bg-surface px-3 py-3 text-center tall:py-4">
            <span className="text-h4 tall:text-h3">{ladder.term}</span>
            <SpeakButton text={ladder.term} />
          </div>
        </div>
        {/* The branches. */}
        <svg
          className="pointer-events-none hidden h-full w-full md:col-start-2 md:block md:row-[var(--rows)]"
          style={{ "--rows": `1 / span ${rows}` } as React.CSSProperties}
          viewBox={`0 0 100 ${rows * 100}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {ladder.rungs.map((r, i) => (
            <path
              key={r.level}
              d={`M0 ${rows * 50} C 55 ${rows * 50}, 45 ${i * 100 + 50}, 100 ${i * 100 + 50}`}
              fill="none"
              strokeWidth={r.term ? 2 : 1}
              strokeDasharray={r.term ? undefined : "4 4"}
              vectorEffect="non-scaling-stroke"
              className={r.term ? "stroke-primary" : "stroke-border"}
            />
          ))}
        </svg>
        {ladder.rungs.map((r, i) => {
          const id = r.term ? result.library[r.term.toLowerCase()] : undefined;
          return (
            <div
              key={r.level}
              style={{ "--row": i + 1 } as React.CSSProperties}
              className={cn(
                "grid content-center gap-0.5 rounded-xl border bg-surface px-3.5 py-2 md:col-start-3 md:row-[var(--row)] tall:gap-1 tall:px-4 tall:py-3",
                !r.term && "border-dashed bg-transparent",
                r.term.toLowerCase() === ladder.term.toLowerCase() && "border-primary/60",
              )}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <LevelTag level={r.level} />
                <span className="text-caption text-fg-muted">{LEVEL_NAMES[r.level]}</span>
                {r.term ? (
                  <>
                    <span className="text-body font-semibold tall:text-h4">{r.term}</span>
                    <SpeakButton text={r.term} />
                    <RegisterTag register={r.register} />
                    {id && (
                      <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={() => onOpenWord(id)}>
                        <BookOpen aria-hidden /> Open
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-caption text-fg-muted italic">no word of its own at this level</span>
                )}
              </div>
              {r.nuance_uz && <p className="text-body-sm leading-snug tall:text-body">{r.nuance_uz}</p>}
              {r.example && (
                <p className="flex items-center gap-2 text-caption text-fg-secondary italic tall:text-body-sm">
                  <span className="min-w-0">“{r.example}”</span>
                  <SpeakButton text={r.example} className="ml-auto" />
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
