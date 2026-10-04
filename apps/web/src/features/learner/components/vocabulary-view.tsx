"use client";

import { BookMarked, CalendarClock, Check, CheckCheck, Plus, Search, SpellCheck, X } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { VocabularyCard } from "@/components/learning/cards";
import { Badge } from "@/components/ui/badge";
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
  // The level whose explanation every card shows; empty means the learner's own.
  const [explainAt, setExplainAt] = useState<string>("");
  const library = useVocabularyLibrary(page, query.trim(), wordLevel);
  const data = library.data?.data;
  const total = library.data?.meta?.total ?? 0;
  const shownLevel = explainAt || data?.learner_level || "B1";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
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
        <LevelChips label="Word level" value={wordLevel} onChange={(v) => (setWordLevel(v), setPage(1))} allLabel="All levels" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
        <span>Explain for</span>
        <LevelChips
          label="Explain for"
          value={explainAt}
          onChange={setExplainAt}
          allLabel={`My level${data?.learner_level ? ` · ${data.learner_level}` : ""}`}
          small
        />
      </div>

      {library.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
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
          <p className="text-caption text-fg-muted tabular-nums">{total} words</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((word) => (
              <WordCard key={word.id} word={word} level={shownLevel} />
            ))}
          </div>
          <Pagination page={page} pageSize={24} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function LevelChips({
  label,
  value,
  onChange,
  allLabel,
  small = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  small?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {["", ...LEVELS].map((code) => (
        <button
          key={code || "all"}
          type="button"
          aria-pressed={value === code}
          onClick={() => onChange(code)}
          className={cn(
            "rounded-lg border outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
            small ? "px-2 py-0.5 text-caption" : "px-3 py-1.5 text-label",
            value === code
              ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
              : "bg-surface text-fg-secondary hover:bg-surface-hover hover:text-foreground",
          )}
        >
          {code || allLabel}
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

function WordCard({ word, level }: { word: LibraryWord; level: string }) {
  const add = useAddToDeck();
  const shown = explanationAt(word.level_content, level);
  const inDeck = word.in_deck || add.data?.added === true;

  return (
    <article className="grid content-start gap-3 rounded-xl border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h3 className="text-h4">{word.term}</h3>
          <p className="text-caption text-fg-muted">
            {word.part_of_speech}
            {word.pronunciation_ipa && ` · ${word.pronunciation_ipa}`}
          </p>
        </div>
        {word.level && <Badge variant="outline">{word.level}</Badge>}
      </div>
      {(word.translations.uz || word.translations.ru) && (
        <p className="text-body-sm">
          {word.translations.uz && <span className="font-medium">{word.translations.uz}</span>}
          {word.translations.uz && word.translations.ru && <span className="text-fg-muted"> · </span>}
          {word.translations.ru && <span className="text-fg-secondary">{word.translations.ru}</span>}
        </p>
      )}
      {shown && (
        <div className="grid gap-1.5 border-t pt-3">
          <p className="text-body-sm">
            <span className="mr-1.5 rounded bg-surface-active px-1 text-[0.6875rem] font-semibold text-fg-muted">{shown.level}</span>
            {shown.text.definition}
          </p>
          {shown.text.examples.length > 0 && (
            <ul className="grid gap-1">
              {shown.text.examples.slice(0, 2).map((example) => (
                <li key={example} className="text-caption text-fg-secondary italic">
                  “{example}”
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="pt-1">
        {inDeck ? (
          <span className="inline-flex items-center gap-1.5 text-caption text-success">
            <Check className="size-3.5" aria-hidden /> In my words
          </span>
        ) : (
          <Button size="sm" variant="outline" loading={add.isPending} onClick={() => add.mutate(word.id)}>
            <Plus aria-hidden /> Add to my words
          </Button>
        )}
      </div>
    </article>
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
