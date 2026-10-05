"use client";

import { ArrowLeftRight, Check, ChevronRight, Plus, Search, SpellCheck, X } from "lucide-react";
import { useMemo, useState } from "react";

import { FlagGB } from "@/components/common/flags";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LexiconKind, LibraryWord, VocabularyLibraryQuery } from "@engora/types";

import { useAddToDeck, useVocabularyLibrary } from "../../hooks";
import { Pagination } from "../pagination";
import {
  Chip,
  DeckBadge,
  KINDS,
  LEVEL_NAMES,
  LEVELS,
  LevelTag,
  RegisterTag,
  Segmented,
  SpeakButton,
  Translations,
  registerLabel,
} from "./shared";

const PAGE_SIZE = 30;

function emptyQuery(kind: LexiconKind): VocabularyLibraryQuery {
  return { page: 1, q: "", level: "", topic: "", pos: "", kind, register: "", sort: "level", show: "all" };
}

/**
 * The library of one kind — words, phrases or collocations — in order: by level (easiest
 * first) unless the learner sorts otherwise, narrowed by topic, formality, type and whether an
 * entry is already theirs. Every row opens into its full page, and any two or three rows can
 * be picked and compared.
 */
export function Library({
  kind,
  onOpenWord,
  onCompare,
}: {
  kind: LexiconKind;
  onOpenWord: (id: string) => void;
  onCompare: (terms: string[]) => void;
}) {
  const names = KINDS[kind];
  const [query, setQuery] = useState<VocabularyLibraryQuery>(() => emptyQuery(kind));
  const [picked, setPicked] = useState<LibraryWord[]>([]);
  const set = (patch: Partial<VocabularyLibraryQuery>) => setQuery((q) => ({ ...q, page: 1, ...patch }));
  const reset = () => setQuery(emptyQuery(kind));
  const library = useVocabularyLibrary({ ...query, q: query.q.trim() });
  const data = library.data?.data;
  const total = library.data?.meta?.total ?? 0;
  const myLevel = data?.learner_level || "B1";
  const facets = data?.facets;
  const filtered = query.q || query.level || query.topic || query.pos || query.register || query.show !== "all";

  const levelCount = (code: string) => facets?.levels.find((f) => f.value === code)?.count ?? 0;
  const allCount = facets?.levels.reduce((n, f) => n + f.count, 0) ?? 0;

  const togglePick = (word: LibraryWord) =>
    setPicked((p) => (p.some((w) => w.id === word.id) ? p.filter((w) => w.id !== word.id) : [...p, word].slice(-3)));

  // Sorted by level with every level shown, the entries fall into one section per level.
  const groups = useMemo(() => {
    const items = data?.items ?? [];
    if (query.sort !== "level" || query.level) return [{ level: "", words: items }];
    const out: { level: string; words: LibraryWord[] }[] = [];
    for (const w of items) {
      const code = w.level ?? "";
      const last = out[out.length - 1];
      if (last && last.level === code) last.words.push(w);
      else out.push({ level: code, words: [w] });
    }
    return out;
  }, [data?.items, query.sort, query.level]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Segmented
          label="Level"
          value={query.level}
          onChange={(level) => set({ level })}
          options={[
            { value: "", label: <LevelLabel code="All" count={allCount} /> },
            ...LEVELS.map((code) => ({
              value: code as string,
              label: <LevelLabel code={code} count={levelCount(code)} />,
              disabled: !!facets && levelCount(code) === 0,
            })),
          ]}
        />
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input
              type="search"
              value={query.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder={names.search}
              aria-label={`Search ${names.plural}`}
              className="h-10 pr-9 pl-9"
            />
            {query.q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => set({ q: "" })}
                className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          <NativeSelect value={query.register} onChange={(e) => set({ register: e.target.value })} aria-label="Formality">
            <option value="">Formal and informal</option>
            {facets?.registers.map((f) => (
              <option key={f.value} value={f.value}>
                {registerLabel(f.value)} ({f.count})
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={query.pos} onChange={(e) => set({ pos: e.target.value })} aria-label="Type">
            <option value="">{kind === "word" ? "Every part of speech" : "Every type"}</option>
            {facets?.parts_of_speech.map((f) => (
              <option key={f.value} value={f.value}>
                {f.value} ({f.count})
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={query.show}
            onChange={(e) => set({ show: e.target.value as VocabularyLibraryQuery["show"] })}
            aria-label="Show"
          >
            <option value="all">All {names.plural}</option>
            <option value="new">Not in my list</option>
            <option value="mine">In my list</option>
          </NativeSelect>
          <NativeSelect
            value={query.sort}
            onChange={(e) => set({ sort: e.target.value as VocabularyLibraryQuery["sort"] })}
            aria-label="Sort"
          >
            <option value="level">By level</option>
            <option value="az">A–Z</option>
            <option value="newest">Newest</option>
          </NativeSelect>
        </div>
        {facets && facets.topics.length > 0 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Topics">
            <Chip active={!query.topic} onClick={() => set({ topic: "" })}>
              Every topic
            </Chip>
            {facets.topics.map((t) => (
              <Chip key={t.value} active={query.topic === t.value} onClick={() => set({ topic: query.topic === t.value ? "" : t.value })}>
                <span className="capitalize">{t.value}</span>
                <span className="text-[0.6875rem] text-fg-muted tabular-nums">{t.count}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>

      {library.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : library.isError ? (
        <ErrorState error={library.error} onRetry={() => void library.refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={SpellCheck}
          title={filtered ? `No ${names.plural} match` : `No ${names.plural} yet`}
          description={filtered ? "Try another search, level or topic." : `New ${names.plural} appear here as soon as they are published.`}
          action={
            filtered ? (
              <Button variant="outline" size="sm" onClick={reset}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-x-2 text-caption text-fg-muted">
            <span>
              <span className="tabular-nums">{total}</span> {total === 1 ? names.singular : names.plural}
            </span>
            <span>·</span>
            <span>
              open one for its meanings, usage and similar {names.plural} · tick <ArrowLeftRight className="inline size-3" aria-label="compare" />{" "}
              on two or three to compare them
            </span>
            {filtered && (
              <Button variant="link" size="sm" className="text-caption" onClick={reset}>
                Clear filters
              </Button>
            )}
          </p>
          <div className="grid gap-4">
            {groups.map((group) => (
              <section key={group.level || "all"} className="grid gap-2">
                {group.level && (
                  <h3 className="flex items-baseline gap-2 px-1">
                    <LevelTag level={group.level} />
                    <span className="text-label">{LEVEL_NAMES[group.level]}</span>
                    {group.level === myLevel && <span className="text-caption text-primary">your level</span>}
                  </h3>
                )}
                <ul className="overflow-hidden rounded-xl border bg-surface">
                  {group.words.map((word) => (
                    <WordRow
                      key={word.id}
                      word={word}
                      picked={picked.some((w) => w.id === word.id)}
                      onPick={() => togglePick(word)}
                      onOpen={() => onOpenWord(word.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <Pagination page={query.page} pageSize={PAGE_SIZE} total={total} onPage={(page) => setQuery((q) => ({ ...q, page }))} />
        </>
      )}

      {picked.length > 0 && (
        <CompareTray
          picked={picked}
          onRemove={(id) => setPicked((p) => p.filter((w) => w.id !== id))}
          onCompare={(terms) => {
            setPicked([]);
            onCompare(terms);
          }}
          onClear={() => setPicked([])}
        />
      )}
    </div>
  );
}

function LevelLabel({ code, count }: { code: string; count: number }) {
  return (
    <>
      {code}
      {count > 0 && <span className="text-[0.6875rem] text-fg-muted tabular-nums">{count}</span>}
    </>
  );
}

/**
 * The entries picked for comparing, kept in view at the bottom of the page. With one picked,
 * its own similar words are offered to compare it with.
 */
function CompareTray({
  picked,
  onRemove,
  onCompare,
  onClear,
}: {
  picked: LibraryWord[];
  onRemove: (id: string) => void;
  onCompare: (terms: string[]) => void;
  onClear: () => void;
}) {
  const terms = picked.map((w) => w.term);
  const suggestions = picked.length === 1 ? picked[0]!.synonyms.slice(0, 3) : [];
  return (
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-surface-elevated p-3 shadow-lg">
      <ArrowLeftRight className="size-4 text-primary" aria-hidden />
      {picked.map((w) => (
        <Chip key={w.id} onClick={() => onRemove(w.id)} title="Remove" active>
          {w.term}
          <X className="size-3" aria-hidden />
        </Chip>
      ))}
      {suggestions.length > 0 && (
        <span className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
          compare with
          {suggestions.map((s) => (
            <Chip key={s} onClick={() => onCompare([terms[0]!, s])}>
              {s}
            </Chip>
          ))}
        </span>
      )}
      <span className="ml-auto flex gap-2">
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
        <Button size="sm" disabled={picked.length < 2} onClick={() => onCompare(terms)}>
          Compare {picked.length > 1 ? terms.join(" vs ") : ""}
        </Button>
      </span>
    </div>
  );
}

/**
 * One entry, one line: it and how it sounds, its meaning in Uzbek and Russian, and its
 * explanation. The row opens the full page; the compare toggle picks it for comparing.
 */
function WordRow({ word, picked, onPick, onOpen }: { word: LibraryWord; picked: boolean; onPick: () => void; onOpen: () => void }) {
  const add = useAddToDeck();
  const inDeck = word.in_deck || add.data?.added === true;

  return (
    <li className={cn("group border-b last:border-b-0", picked && "bg-primary-subtle/30")}>
      <div className="flex items-center gap-2 px-3 py-2.5 transition-colors duration-micro hover:bg-surface-hover/50 sm:px-4">
        <button
          type="button"
          onClick={onOpen}
          className="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-4 gap-y-1 rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:grid-cols-[minmax(8rem,13rem)_minmax(0,1fr)]"
        >
          <span className="grid min-w-0 gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <FlagGB title="English" />
              <span className="truncate font-medium">{word.term}</span>
              <LevelTag level={word.level} />
            </span>
            <span className="flex min-w-0 items-center gap-1.5 pl-[1.5rem] text-[0.6875rem] text-fg-muted">
              {word.pronunciation_ipa && <span className="truncate font-mono">{word.pronunciation_ipa}</span>}
              <span className="truncate">{word.part_of_speech}</span>
              <RegisterTag register={word.register} />
            </span>
          </span>
          <span className="grid min-w-0 gap-0.5 pl-6 sm:pl-0">
            <Translations translations={word.translations} className="text-body-sm" />
            {word.definition && <span className="truncate text-caption text-fg-secondary">{word.definition}</span>}
          </span>
        </button>
        <SpeakButton text={word.term} className="hidden sm:inline-flex" />
        <Button
          size="icon-sm"
          variant={picked ? "subtle" : "ghost"}
          aria-pressed={picked}
          title={picked ? "Picked for comparing" : "Pick to compare"}
          aria-label={`${picked ? "Unpick" : "Pick"} ${word.term} to compare`}
          onClick={onPick}
        >
          <ArrowLeftRight aria-hidden />
        </Button>
        {inDeck ? (
          <span className="w-20 shrink-0 text-right">
            {word.deck_status ? (
              <DeckBadge status={word.deck_status} />
            ) : (
              <span className="inline-flex items-center gap-1 text-caption text-success">
                <Check className="size-4" aria-hidden /> Added
              </span>
            )}
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="w-20 shrink-0"
            loading={add.isPending}
            onClick={() => add.mutate(word.id)}
            aria-label={`Add ${word.term} to my list`}
          >
            <Plus aria-hidden />
            <span className="hidden sm:inline">Add</span>
          </Button>
        )}
        <ChevronRight className="size-4 shrink-0 text-fg-muted transition-transform duration-micro group-hover:translate-x-0.5" aria-hidden />
      </div>
    </li>
  );
}
