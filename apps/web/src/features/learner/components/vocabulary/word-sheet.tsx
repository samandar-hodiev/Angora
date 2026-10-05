"use client";

import { AlertTriangle, ArrowLeftRight, Check, CheckCheck, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { FlagGB } from "@/components/common/flags";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Sheet, SheetContent } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { RelatedWord, WordDetail } from "@engora/types";

import { useAddToDeck, useMarkKnown, useRemoveFromDeck, useVocabularyWord } from "../../hooks";
import { Chip, DeckBadge, LEVEL_NAMES, LEVELS, LevelTag, SpeakButton, Translations, explanationAt, speak } from "./shared";

/**
 * One word, all of it: what it means at every level, how it sounds, how it is used, what it is
 * near — with a way to compare it to those neighbours — and where the learner stands with it.
 */
export function WordSheet({
  id,
  onOpenWord,
  onCompare,
  onClose,
}: {
  id: string | null;
  onOpenWord: (id: string) => void;
  onCompare: (terms: string[]) => void;
  onClose: () => void;
}) {
  const word = useVocabularyWord(id);
  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" title={word.data?.term ?? "Word"} className="w-[min(40rem,100vw)] gap-0 overflow-y-auto p-0">
        {word.isPending ? (
          <div className="grid gap-4 p-6">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <p className="text-caption text-fg-muted">Preparing this word…</p>
          </div>
        ) : word.isError ? (
          <div className="p-6">
            <ErrorState error={word.error} onRetry={() => void word.refetch()} />
          </div>
        ) : (
          <WordBody key={word.data.id} word={word.data} onOpenWord={onOpenWord} onCompare={onCompare} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function WordBody({
  word,
  onOpenWord,
  onCompare,
}: {
  word: WordDetail;
  onOpenWord: (id: string) => void;
  onCompare: (terms: string[]) => void;
}) {
  const { usage } = word;
  const synonyms = word.synonyms.map((s) => s.term);
  return (
    <div className="grid gap-6 pb-8">
      {/* Header: the word, how it sounds, what it is in Uzbek and Russian. */}
      <header className="grid gap-3 border-b bg-surface px-6 pt-6 pb-5">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <FlagGB title="English" />
          <h2 className="text-h2">{word.term}</h2>
          <LevelTag level={word.level} />
          <span className="text-body-sm text-fg-muted">{word.part_of_speech}</span>
          {usage.register && usage.register !== "neutral" && (
            <span className="rounded border px-1.5 py-px text-[0.6875rem] text-fg-secondary">{usage.register}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {word.pronunciation_ipa && <span className="font-mono text-body-sm text-fg-secondary">{word.pronunciation_ipa}</span>}
          <SpeakButton text={word.term} lang="en-GB" label="British pronunciation">
            UK
          </SpeakButton>
          <SpeakButton text={word.term} lang="en-US" label="American pronunciation">
            US
          </SpeakButton>
          <SpeakButton text={word.term} lang="en-GB" slow label="Slowly">
            Slow
          </SpeakButton>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-body">
          <Translations translations={word.translations} />
          {word.translations.ru && <SpeakButton text={word.translations.ru} lang="ru-RU" label="Listen to the Russian" />}
        </div>
        <DeckActions word={word} />
      </header>

      <div className="grid gap-6 px-6">
        <Meaning word={word} />

        {(usage.usage_note || usage.collocations.length > 0 || usage.common_mistake) && (
          <Section title="How to use it">
            {usage.usage_note && <p className="text-body">{usage.usage_note}</p>}
            {usage.collocations.length > 0 && (
              <div className="grid gap-2">
                <p className="text-label text-fg-muted">Goes together with</p>
                <div className="flex flex-wrap gap-2">
                  {usage.collocations.map((c) => (
                    <Chip key={c} onClick={() => speak(c)} title="Listen">
                      <Highlight text={c} term={word.term} />
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {usage.common_mistake && (
              <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
                <div className="grid gap-0.5">
                  <p className="text-label text-warning-text">Common mistake</p>
                  <p className="text-body-sm">{usage.common_mistake}</p>
                </div>
              </div>
            )}
          </Section>
        )}

        {(word.synonyms.length > 0 || word.antonyms.length > 0 || usage.word_family.length > 0) && (
          <Section
            title="Similar and opposite"
            action={
              synonyms.length > 0 && (
                <Button size="sm" variant="subtle" onClick={() => onCompare([word.term, ...synonyms.slice(0, 2)])}>
                  <ArrowLeftRight aria-hidden /> Compare all
                </Button>
              )
            }
          >
            {word.synonyms.length > 0 && (
              <div className="grid gap-2">
                <p className="text-label text-fg-muted">Similar words — what is the difference?</p>
                <ul className="grid gap-1.5">
                  {word.synonyms.map((s) => (
                    <li key={s.term} className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2">
                      <RelatedLink word={s} onOpenWord={onOpenWord} />
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onCompare([word.term, s.term])}>
                        <ArrowLeftRight aria-hidden /> {word.term} vs {s.term}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {word.antonyms.length > 0 && (
              <div className="grid gap-2">
                <p className="text-label text-fg-muted">Opposite</p>
                <div className="flex flex-wrap gap-2">
                  {word.antonyms.map((a) => (
                    <RelatedChip key={a.term} word={a} onOpenWord={onOpenWord} />
                  ))}
                </div>
              </div>
            )}
            {usage.word_family.length > 0 && (
              <div className="grid gap-2">
                <p className="text-label text-fg-muted">Word family</p>
                <div className="flex flex-wrap gap-2">
                  {usage.word_family.map((f) => (
                    <Chip key={f} onClick={() => speak(f)} title="Listen">
                      {f}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {word.same_topic.length > 0 && (
          <Section title={`More about ${word.tags.join(", ")}`}>
            <div className="flex flex-wrap gap-2">
              {word.same_topic.map((r) => (
                <RelatedChip key={r.term} word={r} onOpenWord={onOpenWord} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-h4">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The word explained at one level at a time — the learner's own first, any other a tap away. */
function Meaning({ word }: { word: WordDetail }) {
  const start = explanationAt(word.level_content, word.learner_level)?.level ?? word.learner_level;
  const [level, setLevel] = useState(start);
  const text = word.level_content[level];
  const shownLevel = text?.same_as ?? level;
  return (
    <Section title="Meaning">
      <div role="tablist" aria-label="Explained for level" className="grid grid-cols-6 gap-1 rounded-xl border bg-surface p-1">
        {LEVELS.map((code) => {
          const has = !!word.level_content[code]?.definition;
          return (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={level === code}
              disabled={!has}
              onClick={() => setLevel(code)}
              title={has ? LEVEL_NAMES[code] : "Not explained at this level"}
              className={cn(
                "relative rounded-lg py-1.5 text-label outline-none transition-colors duration-micro",
                "focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-35",
                level === code ? "bg-primary-subtle text-primary-subtle-foreground" : "text-fg-secondary hover:text-foreground",
              )}
            >
              {code}
              {code === word.learner_level && (
                <span className="absolute top-1 right-1.5 size-1.5 rounded-full bg-primary" aria-label="your level" />
              )}
            </button>
          );
        })}
      </div>
      {text ? (
        <div className="grid gap-3 rounded-xl border bg-surface p-4">
          <p className="flex items-center gap-2 text-caption text-fg-muted">
            Explained for {level} · {LEVEL_NAMES[level]}
            {level === word.learner_level && <span className="text-primary">your level</span>}
            {shownLevel !== level && <span>(same as {shownLevel})</span>}
          </p>
          <p className="text-body-lg">{text.definition}</p>
          {text.examples.length > 0 && (
            <ul className="grid gap-2">
              {text.examples.map((example) => (
                <li key={example} className="flex items-start gap-2 border-l-2 border-primary/40 pl-3">
                  <p className="text-body-sm text-fg-secondary italic">
                    <Highlight text={example} term={word.term} />
                  </p>
                  <SpeakButton text={example} className="ml-auto" />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-body-sm text-fg-muted">Not explained at this level yet.</p>
      )}
    </Section>
  );
}

/** The sentence with the word in it picked out, so the eye finds it. */
function Highlight({ text, term }: { text: string; term: string }) {
  const stem = term.toLowerCase().slice(0, Math.max(3, term.length - 2));
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) =>
        part
          .toLowerCase()
          .replace(/[^a-z'-]/g, "")
          .startsWith(stem) ? (
          <mark key={i} className="rounded bg-primary-subtle px-0.5 text-primary-subtle-foreground not-italic">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function RelatedLink({ word, onOpenWord }: { word: RelatedWord; onOpenWord: (id: string) => void }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {word.id ? (
        <button
          type="button"
          onClick={() => onOpenWord(word.id!)}
          className="truncate font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {word.term}
        </button>
      ) : (
        <span className="truncate font-medium">{word.term}</span>
      )}
      <LevelTag level={word.level} />
      {word.uz && <span className="truncate text-caption text-fg-muted">{word.uz}</span>}
      <SpeakButton text={word.term} />
    </span>
  );
}

function RelatedChip({ word, onOpenWord }: { word: RelatedWord; onOpenWord: (id: string) => void }) {
  return (
    <Chip
      onClick={word.id ? () => onOpenWord(word.id!) : () => speak(word.term)}
      title={word.id ? "Open this word" : "Listen"}
      className={word.id ? "text-foreground" : undefined}
    >
      {word.term}
      {word.level && <span className="text-[0.6875rem] text-fg-muted">{word.level}</span>}
    </Chip>
  );
}

/** Add the word to my words, say I already know it, or take it out again. */
function DeckActions({ word }: { word: WordDetail }) {
  const add = useAddToDeck();
  const known = useMarkKnown();
  const remove = useRemoveFromDeck();
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!word.deck) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={add.isPending} onClick={() => add.mutate(word.id)}>
          <Plus aria-hidden /> Add to my words
        </Button>
        <Button size="sm" variant="outline" loading={known.isPending} onClick={() => known.mutate(word.id)}>
          <CheckCheck aria-hidden /> I already know it
        </Button>
      </div>
    );
  }
  const due = new Date(word.deck.due_at);
  return (
    <div className="grid gap-2 rounded-lg border bg-surface-hover/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Check className="size-4 text-success" aria-hidden />
        <span className="text-label">In my words</span>
        <DeckBadge status={word.deck.status} />
        <span className="text-caption text-fg-muted">
          {word.deck.reviews} review{word.deck.reviews === 1 ? "" : "s"} · next{" "}
          {due <= new Date() ? "now" : due.toLocaleDateString()}
        </span>
        <span className="ml-auto flex gap-1">
          {word.deck.status !== "mastered" && (
            <Button size="sm" variant="ghost" loading={known.isPending} onClick={() => known.mutate(word.id)}>
              <CheckCheck aria-hidden /> I know it
            </Button>
          )}
          <Button
            size="sm"
            variant={confirmRemove ? "destructive" : "ghost"}
            loading={remove.isPending}
            onClick={() => (confirmRemove ? remove.mutate(word.id) : setConfirmRemove(true))}
            aria-label="Remove from my words"
          >
            <Trash2 aria-hidden /> {confirmRemove ? "Remove?" : ""}
          </Button>
        </span>
      </div>
      <Meter label="Mastery" value={word.deck.mastery} />
    </div>
  );
}
