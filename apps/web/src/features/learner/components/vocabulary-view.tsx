"use client";

import { ArrowLeftRight, BookMarked, Compass, GitBranch } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { cn } from "@/lib/utils";
import type { LexiconKind } from "@engora/types";

import { useVocabularyDeck } from "../hooks";
import { ComparePanel } from "./vocabulary/compare-panel";
import { Deck } from "./vocabulary/deck";
import { LadderPanel } from "./vocabulary/ladder-panel";
import { Library } from "./vocabulary/library";
import { KINDS } from "./vocabulary/shared";
import { WordSheet } from "./vocabulary/word-sheet";

type Tab = "explore" | "ladder" | "compare" | "deck";

/**
 * One page of the Lexicon — vocabulary, phrases or collocations. Explore the entries by level,
 * topic and formality; climb a word's level ladder (words only); compare entries that look the
 * same in Uzbek or Russian; and review the learner's own list with spaced repetition. Any
 * entry, from any tab, opens into one page with everything about it.
 */
export function VocabularyView({ kind = "word" }: { kind?: LexiconKind }) {
  const names = KINDS[kind];
  const [tab, setTab] = useState<Tab>("explore");
  const [wordId, setWordId] = useState<string | null>(null);
  const [compareTerms, setCompareTerms] = useState<string[] | null>(null);
  // Only for the due count on the tab; the deck tab reads its own page.
  const deck = useVocabularyDeck(1, "", kind);
  const due = deck.data?.data?.summary.due ?? 0;

  const compare = (terms: string[]) => {
    setWordId(null);
    setCompareTerms(terms);
    setTab("compare");
  };

  const tabs: { value: Tab; label: string; icon: typeof Compass; badge?: number }[] = [
    { value: "explore", label: "Explore", icon: Compass },
    ...(kind === "word" ? [{ value: "ladder" as const, label: "Level ladder", icon: GitBranch }] : []),
    { value: "compare", label: "Compare", icon: ArrowLeftRight },
    { value: "deck", label: "My list", icon: BookMarked, badge: due },
  ];

  return (
    <>
      <PageHeader pinned={false} compact title={names.title} description={names.description} />
      <div role="tablist" aria-label={names.title} className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-surface p-1">
        {tabs.map(({ value, label, icon: Icon, badge }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-4 py-1.5 text-label whitespace-nowrap outline-none transition-colors duration-micro",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              tab === value ? "bg-primary-subtle text-primary-subtle-foreground" : "text-fg-secondary hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {!!badge && (
              <span className="rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground tabular-nums">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "explore" && <Library kind={kind} onOpenWord={setWordId} onCompare={compare} />}
      {tab === "ladder" && <LadderPanel onOpenWord={setWordId} onCompare={compare} />}
      {tab === "compare" && (
        <ComparePanel key={compareTerms?.join("|") ?? ""} kind={kind} initial={compareTerms} onOpenWord={setWordId} />
      )}
      {tab === "deck" && <Deck kind={kind} onOpenWord={setWordId} />}

      <WordSheet id={wordId} onOpenWord={setWordId} onCompare={compare} onClose={() => setWordId(null)} />
    </>
  );
}
