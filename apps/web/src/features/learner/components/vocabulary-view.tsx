"use client";

import { ArrowLeftRight, BookMarked, Compass } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { cn } from "@/lib/utils";

import { useVocabularyDeck } from "../hooks";
import { ComparePanel } from "./vocabulary/compare-panel";
import { Deck } from "./vocabulary/deck";
import { Library } from "./vocabulary/library";
import { WordSheet } from "./vocabulary/word-sheet";

type Tab = "explore" | "compare" | "deck";

/**
 * Vocabulary: explore every word by level and topic, compare words that look the same in
 * Uzbek or Russian, and review the learner's own words with spaced repetition. Any word, from
 * any tab, opens into one page with everything about it.
 */
export function VocabularyView() {
  const [tab, setTab] = useState<Tab>("explore");
  const [wordId, setWordId] = useState<string | null>(null);
  const [compareTerms, setCompareTerms] = useState<string[] | null>(null);
  // Only for the due count on the tab; the deck tab reads its own page.
  const deck = useVocabularyDeck(1, "");
  const due = deck.data?.data?.summary.due ?? 0;

  const compare = (terms: string[]) => {
    setWordId(null);
    setCompareTerms(terms);
    setTab("compare");
  };

  const tabs: {
    value: Tab;
    label: string;
    icon: typeof Compass;
    badge?: number;
  }[] = [
    { value: "explore", label: "Explore", icon: Compass },
    { value: "compare", label: "Compare", icon: ArrowLeftRight },
    { value: "deck", label: "My words", icon: BookMarked, badge: due },
  ];

  return (
    <>
      <PageHeader
        pinned={false}
        compact
        title="Vocabulary"
        description="Words by level and topic, how to use them, how they differ — and the ones you are learning."
      />
      <div role="tablist" aria-label="Vocabulary" className="mb-5 inline-flex gap-1 rounded-xl border bg-surface p-1">
        {tabs.map(({ value, label, icon: Icon, badge }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-1.5 text-label outline-none transition-colors duration-micro",
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

      {tab === "explore" && <Library onOpenWord={setWordId} onCompare={compare} />}
      {tab === "compare" && <ComparePanel key={compareTerms?.join("|") ?? ""} initial={compareTerms} onOpenWord={setWordId} />}
      {tab === "deck" && <Deck onOpenWord={setWordId} />}

      <WordSheet id={wordId} onOpenWord={setWordId} onCompare={compare} onClose={() => setWordId(null)} />
    </>
  );
}
