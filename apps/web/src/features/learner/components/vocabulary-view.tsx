"use client";

import { BookMarked, CalendarClock, Check, CheckCheck, ChevronRight, Plus, Search, SpellCheck, X } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { VocabularyCard } from "@/components/learning/cards";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/data-display";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LibraryWord, VocabularyLevelText } from "@engora/types";

import { useAddToDeck, useVocabularyDeck, useVocabularyLibrary } from "../hooks";
import { Pagination } from "./pagination";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

type Tab = "library" | "deck";

/**
 * Vocabulary: every word in one place, and the learner's own deck.
 *
 * The library lists every published word, from every level, together — a learner looking a
 * word up should not have to know which level it was filed under. Each word is explained for
 * the learner's own level first; any other level is one tap away.
 */
export function VocabularyView() {
  const [tab, setTab] = useState<Tab>("library");

  return (
    <>
      <PageHeader
        pinned={false}
        compact
        title="Vocabulary"
        description="Every word, explained for your level — and the ones you are learning."
      />
      <div role="tablist" aria-label="Vocabulary" className="mb-5 inline-flex gap-1 rounded-xl border bg-surface p-1">
        {(
          [
            ["library", "All words"],
            ["deck", "My words"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-label outline-none transition-colors duration-micro",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              tab === value ? "bg-primary-subtle text-primary-subtle-foreground" : "text-fg-secondary hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "library" ? <Library /> : <Deck />}
    </>
  );
}

function Library() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [wordLevel, setWordLevel] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const library = useVocabularyLibrary(page, query.trim(), wordLevel);
  const data = library.data?.data;
  const total = library.data?.meta?.total ?? 0;
  const myLevel = data?.learner_level || "B1";

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <LevelTabs value={wordLevel} onChange={(v) => (setWordLevel(v), setPage(1), setOpenId(null))} />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search a word, or its Uzbek or Russian meaning"
            aria-label="Search words"
            className="h-10 pr-9 pl-9"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {library.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : library.isError ? (
        <ErrorState error={library.error} onRetry={() => void library.refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={SpellCheck}
          title={query || wordLevel ? "No words match" : "No words yet"}
          description={query || wordLevel ? "Try another word or level." : "New words appear here as soon as they are published."}
        />
      ) : (
        <>
          <p className="text-caption text-fg-muted">
            <span className="tabular-nums">{total}</span> {wordLevel ? `${wordLevel} ` : ""}words · explained for your level ({myLevel}) —
            open a word to see it at every level
          </p>
          <ul className="overflow-hidden rounded-xl border bg-surface">
            {data.items.map((word) => (
              <WordRow
                key={word.id}
                word={word}
                level={myLevel}
                open={openId === word.id}
                onToggle={() => setOpenId(openId === word.id ? null : word.id)}
              />
            ))}
          </ul>
          <Pagination page={page} pageSize={24} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** The word-level filter: every level together, or one level at a time. */
function LevelTabs({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div role="tablist" aria-label="Word level" className="flex gap-1 overflow-x-auto rounded-xl border bg-surface p-1">
      {["", ...LEVELS].map((code) => (
        <button
          key={code || "all"}
          type="button"
          role="tab"
          aria-selected={value === code}
          onClick={() => onChange(code)}
          className={cn(
            "min-w-12 flex-1 shrink-0 rounded-lg px-3 py-1.5 text-label outline-none transition-colors duration-micro",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40",
            value === code ? "bg-primary-subtle text-primary-subtle-foreground" : "text-fg-secondary hover:text-foreground",
          )}
        >
          {code || "All"}
        </button>
      ))}
    </div>
  );
}

/** The explanation at the level asked for, or the nearest one written — lower first. */
function explanationAt(content: LibraryWord["level_content"], level: string): { level: string; text: VocabularyLevelText } | null {
  const at = Math.max(0, LEVELS.indexOf(level as (typeof LEVELS)[number]));
  for (let d = 0; d < LEVELS.length; d++) {
    for (const i of d === 0 ? [at] : [at - d, at + d]) {
      const code = LEVELS[i];
      const text = code ? content[code] : undefined;
      if (text?.definition) return { level: code!, text };
    }
  }
  return null;
}

/**
 * The levels in order, with neighbours that share one explanation folded into a single
 * group — "A1–B1" — so the same text is not shown three times. Levels without one are
 * their own empty group.
 */
function levelGroups(content: LibraryWord["level_content"]): { codes: string[]; text?: VocabularyLevelText }[] {
  const groups: { codes: string[]; text?: VocabularyLevelText; root?: string }[] = [];
  for (const code of LEVELS) {
    const text = content[code];
    const last = groups[groups.length - 1];
    if (text?.same_as && last?.text && (last.root === text.same_as || last.codes[0] === text.same_as)) {
      last.codes.push(code);
      continue;
    }
    groups.push({ codes: [code], text: text?.definition ? text : undefined, root: code });
  }
  return groups;
}

/**
 * One word, one line: the word, its meaning in the learner's language, and its explanation
 * at their level. Opened, the same row shows the word explained at every level side by side.
 */
function WordRow({ word, level, open, onToggle }: { word: LibraryWord; level: string; open: boolean; onToggle: () => void }) {
  const add = useAddToDeck();
  const shown = explanationAt(word.level_content, level);
  const inDeck = word.in_deck || add.data?.added === true;
  const translation = [word.translations.uz, word.translations.ru].filter(Boolean).join(" · ");

  return (
    <li className="border-b last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="grid min-w-0 flex-1 grid-cols-1 items-baseline gap-x-4 gap-y-0.5 rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)]"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <ChevronRight
              className={cn("size-3.5 shrink-0 self-center text-fg-muted transition-transform duration-micro", open && "rotate-90")}
              aria-hidden
            />
            <span className="truncate font-medium">{word.term}</span>
            {word.level && <span className="shrink-0 text-[0.6875rem] font-semibold text-fg-muted">{word.level}</span>}
          </span>
          <span className="min-w-0 truncate pl-5 text-body-sm text-fg-secondary sm:pl-0">
            {translation && <span className="font-medium text-foreground">{translation}</span>}
            {translation && shown && <span className="text-fg-muted"> — </span>}
            {shown?.text.definition}
          </span>
        </button>
        {inDeck ? (
          <span className="flex shrink-0 items-center gap-1 text-caption text-success" title="In my words">
            <Check className="size-4" aria-hidden />
            <span className="hidden sm:inline">Added</span>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            loading={add.isPending}
            onClick={() => add.mutate(word.id)}
            aria-label={`Add ${word.term} to my words`}
          >
            <Plus aria-hidden />
            <span className="hidden sm:inline">Add</span>
          </Button>
        )}
      </div>
      {open && (
        <div className="grid gap-3 border-t bg-surface-hover/40 px-3 py-3 sm:px-4">
          <p className="text-caption text-fg-muted">
            {word.part_of_speech}
            {word.pronunciation_ipa && ` · ${word.pronunciation_ipa}`}
            {word.tags.length > 0 && ` · ${word.tags.join(", ")}`}
          </p>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="grid min-w-max grid-flow-col auto-cols-[minmax(13rem,1fr)] gap-2">
              {levelGroups(word.level_content).map(({ codes, text }) => {
                const code = codes.length > 1 ? `${codes[0]}–${codes[codes.length - 1]}` : codes[0]!;
                const mine = codes.includes(level);
                return (
                  <div
                    key={code}
                    className={cn(
                      "grid content-start gap-1.5 rounded-lg border bg-surface p-3",
                      mine && "border-primary/60",
                      !text && "opacity-50",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[0.6875rem] font-semibold">
                      {code}
                      {mine && <span className="font-normal text-primary">your level</span>}
                    </span>
                    {text ? (
                      <>
                        <p className="text-body-sm">{text.definition}</p>
                        {text.examples.slice(0, 2).map((example) => (
                          <p key={example} className="text-caption text-fg-secondary italic">
                            “{example}”
                          </p>
                        ))}
                      </>
                    ) : (
                      <p className="text-caption text-fg-muted">Not explained at this level yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function Deck() {
  const [page, setPage] = useState(1);
  const deck = useVocabularyDeck(page);
  const data = deck.data?.data;

  if (deck.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    );
  }
  if (deck.isError) return <ErrorState error={deck.error} onRetry={() => void deck.refetch()} />;
  if (!data || data.summary.total === 0) {
    return (
      <EmptyState
        icon={SpellCheck}
        title="No words in your list yet"
        description="Add words from “All words”; new words at your level are added for you as well."
      />
    );
  }
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Words" value={data.summary.total} icon={BookMarked} />
        <Stat label="Due for review" value={data.summary.due} icon={CalendarClock} />
        <Stat
          label="Mastered"
          value={data.summary.mastered}
          icon={CheckCheck}
          hint={`${data.summary.learning + data.summary.reviewing} in progress`}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((card) => (
          <VocabularyCard key={card.id} card={card} />
        ))}
      </div>
      <Pagination page={page} pageSize={24} total={data.summary.total} onPage={setPage} />
    </>
  );
}
