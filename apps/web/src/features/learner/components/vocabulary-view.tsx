"use client";

import { BookMarked, CalendarClock, CheckCheck, SpellCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { VocabularyCard } from "@/components/learning/cards";
import { Stat } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";

import { useVocabularyDeck } from "../hooks";
import { Pagination } from "./pagination";

export function VocabularyView() {
  const [page, setPage] = useState(1);
  const deck = useVocabularyDeck(page);
  const data = deck.data?.data;

  return (
    <>
      <PageHeader title="Vocabulary" description="Your word bank, ordered by what's due for review." />
      {deck.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : deck.isError ? (
        <ErrorState error={deck.error} onRetry={() => void deck.refetch()} />
      ) : !data || data.summary.total === 0 ? (
        <EmptyState icon={SpellCheck} title="Your word bank is empty" description="Words from lessons and from your mistakes will be added here automatically." />
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <Stat label="Words" value={data.summary.total} icon={BookMarked} />
            <Stat label="Due for review" value={data.summary.due} icon={CalendarClock} />
            <Stat label="Mastered" value={data.summary.mastered} icon={CheckCheck} hint={`${data.summary.learning + data.summary.reviewing} in progress`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.cards.map((card) => (
              <VocabularyCard key={card.id} card={card} />
            ))}
          </div>
          <Pagination page={page} pageSize={24} total={data.summary.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
