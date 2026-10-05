"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BookMarked, CalendarClock, CheckCheck, Flame, PartyPopper, Play, RotateCcw, SpellCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Meter, Stat } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import type { ReviewQueue, ReviewRating, VocabularyCard } from "@engora/types";

import { learnerApi } from "../../api";
import { useMarkKnown, useReviewWord, useVocabularyDeck } from "../../hooks";
import { Pagination } from "../pagination";
import { DeckBadge, LevelTag, Segmented, SpeakButton, Translations, explanationAt } from "./shared";

type Filter = "" | "due" | "new" | "learning" | "mastered";

/** The learner's own words: what is due, a review session, and every word with its progress. */
export function Deck({ onOpenWord }: { onOpenWord: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("");
  const [session, setSession] = useState<{
    n: number;
    queue: ReviewQueue;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const client = useQueryClient();
  const deck = useVocabularyDeck(page, filter);
  const data = deck.data?.data;
  const total = deck.data?.meta?.total ?? 0;
  const learnerLevel = data?.learner_level || "B1";

  // The queue is read fresh when a session starts, and the session keeps it: refetching mid-way
  // would reshuffle the cards under the learner.
  const startReview = async () => {
    setStarting(true);
    try {
      const queue = await client.fetchQuery({
        queryKey: queryKeys.vocabulary.review,
        queryFn: learnerApi.reviewQueue,
        staleTime: 0,
      });
      setSession((s) => ({ n: (s?.n ?? 0) + 1, queue }));
    } finally {
      setStarting(false);
    }
  };

  if (session) {
    return (
      <ReviewSession
        key={session.n}
        queue={session.queue}
        level={learnerLevel}
        starting={starting}
        onMore={() => void startReview()}
        onDone={() => {
          setSession(null);
          void client.invalidateQueries({ queryKey: ["vocabulary"] });
        }}
      />
    );
  }

  if (deck.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
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
        description="Add words from Explore; new words at your level are added for you as well."
      />
    );
  }
  const s = data.summary;
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 rounded-xl border bg-surface p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="grid gap-1">
          <h2 className="text-h3">{s.due > 0 ? `${s.due} word${s.due === 1 ? "" : "s"} to review` : "All caught up"}</h2>
          <p className="text-body-sm text-fg-secondary">
            {s.due > 0
              ? "A few minutes now keeps them from slipping away. Words you remember come back less often."
              : "Nothing is due right now. Add new words from Explore, or come back later."}
          </p>
        </div>
        <Button size="lg" variant="liquid" disabled={s.due === 0} loading={starting} onClick={() => void startReview()}>
          <Play aria-hidden /> Start review
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="My words" value={s.total} icon={BookMarked} hint={`${s.new} not started`} />
        <Stat label="Due now" value={s.due} icon={CalendarClock} />
        <Stat label="Mastered" value={s.mastered} icon={CheckCheck} hint={`${s.learning + s.reviewing} in progress`} />
        <Stat label="Reviewed today" value={s.reviewed_today} icon={Flame} />
      </div>

      <Segmented
        label="Show"
        value={filter}
        onChange={(f) => (setFilter(f), setPage(1))}
        className="sm:w-fit"
        options={[
          { value: "", label: `All ${s.total}` },
          { value: "due", label: `Due ${s.due}` },
          { value: "new", label: `New ${s.new}` },
          { value: "learning", label: `Learning ${s.learning + s.reviewing}` },
          { value: "mastered", label: `Mastered ${s.mastered}` },
        ]}
      />

      {data.cards.length === 0 ? (
        <EmptyState icon={SpellCheck} title="No words here" description="Pick another group above." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.cards.map((card) => (
            <DeckCard key={card.id} card={card} level={learnerLevel} onOpen={() => onOpenWord(card.id)} />
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={24} total={total} onPage={setPage} />
    </div>
  );
}

function DeckCard({ card, level, onOpen }: { card: VocabularyCard; level: string; onOpen: () => void }) {
  const known = useMarkKnown();
  const shown = explanationAt(card.level_content ?? {}, level);
  const definition = shown?.text.definition ?? card.definition;
  const example = shown?.text.examples[0] ?? card.examples[0];
  const due = new Date(card.due_at);
  return (
    <article className="grid content-start gap-3 rounded-xl border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="grid gap-0.5 rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <span className="flex items-center gap-2">
            <span className="text-h3 hover:text-primary">{card.term}</span>
            <LevelTag level={card.level} />
          </span>
          <span className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
            {card.pronunciation_ipa && <span className="font-mono">{card.pronunciation_ipa}</span>}
            {card.part_of_speech}
          </span>
        </button>
        <SpeakButton text={card.term} />
      </div>
      {card.translations && <Translations translations={card.translations} className="text-body-sm" />}
      <p className="text-body">{definition}</p>
      {example && (
        <blockquote className="border-l-2 border-primary/40 pl-3 text-body-sm text-fg-secondary italic">“{example}”</blockquote>
      )}
      <div className="flex items-center justify-between gap-2 text-caption text-fg-muted">
        <DeckBadge status={card.status} />
        <span>{due <= new Date() ? "Due now" : `Next: ${due.toLocaleDateString()}`}</span>
      </div>
      <Meter label="Mastery" value={card.mastery} />
      <div className="flex gap-2">
        {card.status !== "mastered" && (
          <Button variant="outline" size="sm" className="flex-1" loading={known.isPending} onClick={() => known.mutate(card.id)}>
            I know it
          </Button>
        )}
        <Button variant="subtle" size="sm" className="flex-1" onClick={onOpen}>
          Details
        </Button>
      </div>
    </article>
  );
}

const RATINGS: {
  rating: ReviewRating;
  label: string;
  hint: string;
  key: string;
  tone: string;
}[] = [
  {
    rating: "again",
    label: "Again",
    hint: "forgot",
    key: "1",
    tone: "border-error/50 hover:bg-error/10 text-error",
  },
  {
    rating: "hard",
    label: "Hard",
    hint: "with effort",
    key: "2",
    tone: "border-warning/50 hover:bg-warning/10 text-warning-text",
  },
  {
    rating: "good",
    label: "Good",
    hint: "remembered",
    key: "3",
    tone: "border-primary/50 hover:bg-primary-subtle text-primary",
  },
  {
    rating: "easy",
    label: "Easy",
    hint: "instantly",
    key: "4",
    tone: "border-success/50 hover:bg-success/10 text-success",
  },
];

/**
 * Flashcards. The word first; the learner recalls its meaning, turns the card and says how it
 * went. A forgotten word comes back at the end of the session, once.
 */
function ReviewSession({
  queue,
  level,
  starting,
  onMore,
  onDone,
}: {
  queue: ReviewQueue;
  level: string;
  starting: boolean;
  onMore: () => void;
  onDone: () => void;
}) {
  const review = useReviewWord();
  const [cards, setCards] = useState<VocabularyCard[]>(queue.cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<Record<ReviewRating, number>>({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });
  const requeued = useRef(new Set<string>());
  const shownAt = useRef(0);

  const card = cards[index];

  // The clock for how long recalling took starts when a card is put in front of the learner.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  const rate = useCallback(
    (rating: ReviewRating) => {
      if (!card || !flipped || review.isPending) return;
      review.mutate({
        id: card.id,
        rating,
        responseMs: shownAt.current ? Date.now() - shownAt.current : undefined,
      });
      setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
      if (rating === "again" && !requeued.current.has(card.id)) {
        requeued.current.add(card.id);
        setCards((cs) => [...cs, card]);
      }
      setIndex((i) => i + 1);
      setFlipped(false);
    },
    [card, flipped, review],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped(true);
      }
      const r = RATINGS.find((x) => x.key === e.key);
      if (r) rate(r.rating);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rate]);

  if (!card) {
    const done = Object.values(tally).reduce((a, b) => a + b, 0);
    return (
      <div className="grid justify-items-center gap-4 rounded-xl border bg-surface p-8 text-center">
        <PartyPopper className="size-10 text-primary" aria-hidden />
        <h2 className="text-h2">Session complete</h2>
        <p className="text-body text-fg-secondary">
          {done} review{done === 1 ? "" : "s"} · {tally.good + tally.easy} remembered · {tally.hard} hard · {tally.again}{" "}
          forgotten
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {queue.remaining > 0 && (
            <Button loading={starting} onClick={onMore}>
              <RotateCcw aria-hidden /> Review {queue.remaining} more
            </Button>
          )}
          <Button variant="outline" onClick={onDone}>
            Back to my words
          </Button>
        </div>
      </div>
    );
  }

  const shown = explanationAt(card.level_content ?? {}, level);
  const progress = Math.round((index / cards.length) * 100);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onDone}>
          End
        </Button>
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-surface-active"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-normal" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-caption text-fg-muted tabular-nums">
          {index + 1} / {cards.length}
        </span>
      </div>

      <div
        className={cn(
          "grid min-h-80 content-center justify-items-center gap-4 rounded-2xl border bg-surface p-8 text-center",
          flipped && "content-start",
        )}
      >
        <div className="flex items-center gap-2">
          <LevelTag level={card.level} />
          <span className="text-caption text-fg-muted">{card.part_of_speech}</span>
        </div>
        <div className="flex items-center gap-2">
          <h2 className="text-display">{card.term}</h2>
          <SpeakButton text={card.term} />
        </div>
        {card.pronunciation_ipa && <p className="font-mono text-body text-fg-muted">{card.pronunciation_ipa}</p>}

        {!flipped ? (
          <>
            <p className="text-body-sm text-fg-secondary">What does it mean? Say it to yourself, then turn the card.</p>
            <Button size="lg" onClick={() => setFlipped(true)}>
              Show answer <kbd className="ml-1 rounded border px-1 text-[0.6875rem] opacity-70">Space</kbd>
            </Button>
          </>
        ) : (
          <div className="grid w-full gap-3 border-t pt-4 text-left">
            {card.translations && <Translations translations={card.translations} className="justify-center text-body-lg" />}
            <p className="text-center text-body-lg">{shown?.text.definition ?? card.definition}</p>
            {(shown?.text.examples ?? card.examples).slice(0, 2).map((ex) => (
              <p
                key={ex}
                className="flex items-start gap-2 border-l-2 border-primary/40 pl-3 text-body-sm text-fg-secondary italic"
              >
                {ex}
                <SpeakButton text={ex} className="ml-auto" />
              </p>
            ))}
            {(card.collocations ?? []).length > 0 && (
              <p className="text-center text-caption text-fg-muted">{card.collocations!.slice(0, 4).join(" · ")}</p>
            )}
          </div>
        )}
      </div>

      {flipped && (
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map((r) => (
            <button
              key={r.rating}
              type="button"
              onClick={() => rate(r.rating)}
              className={cn(
                "grid gap-0.5 rounded-xl border bg-surface px-2 py-3 text-center outline-none transition-colors duration-micro",
                "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                r.tone,
              )}
            >
              <span className="text-label">{r.label}</span>
              <span className="text-[0.6875rem] text-fg-muted">
                {r.hint} · {r.key}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
