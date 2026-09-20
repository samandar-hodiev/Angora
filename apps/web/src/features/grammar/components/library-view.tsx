"use client";

import {
  ArrowRight,
  ChevronRight,
  Folder,
  FolderOpen,
  Map as MapIcon,
  Search,
  Target,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { EmptyState, ErrorState, InlineLoader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrammarCategory, GrammarTopicSummary } from "@engora/types";

import type { GrammarLevelFilter } from "../api";
import { useGrammarCategories, useGrammarOverview, useGrammarSearch, useGrammarTopics } from "../hooks";
import { MasteryBar, TopicRow } from "./shared";

const LEVELS: { value: GrammarLevelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "me", label: "My Level" },
  { value: "A1", label: "A1" },
  { value: "A2", label: "A2" },
  { value: "B1", label: "B1" },
  { value: "B2", label: "B2" },
  { value: "C1", label: "C1" },
  { value: "C2", label: "C2" },
];

/**
 * The grammar library.
 *
 * Search replaces the browse view while there is a query, rather than sitting beside it:
 * a learner who has typed something is looking for one topic, not browsing a curriculum.
 * Categories are collapsed and fetch their topics when opened, because the curriculum is
 * a few hundred topics and grows with every release.
 */
export function GrammarLibraryView() {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<GrammarLevelFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const categories = useGrammarCategories();
  const overview = useGrammarOverview();
  const search = useGrammarSearch(query, level);
  const searching = query.trim().length > 0;

  return (
    <>
      <PageHeader
        title="Grammar"
        description="Every rule, with practice that knows what you keep getting wrong."
        actions={
          <Button variant="outline" asChild>
            <Link href="/app/grammar/map">
              <MapIcon aria-hidden />
              Grammar map
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6">
        <div className="grid gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search grammar topics..."
              aria-label="Search grammar topics"
              className="h-11 pr-10 pl-9"
            />
            {searching && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-muted outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>

          <div role="group" aria-label="Filter by level" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {LEVELS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={level === option.value}
                onClick={() => setLevel(option.value)}
                className={cn(
                  "shrink-0 rounded-lg border px-3 py-1.5 text-label transition-colors duration-micro outline-none",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  level === option.value
                    ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
                    : "bg-surface text-fg-secondary hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {searching ? (
          <SearchResults
            query={query}
            state={search}
            onSuggestion={(s) => {
              setQuery(s);
              searchRef.current?.focus();
            }}
          />
        ) : (
          <>
            <ForYou overview={overview} />
            <section aria-labelledby="categories-title">
              <SectionTitle id="categories-title" title="Grammar categories" />
              {categories.isPending ? (
                <div className="grid gap-2">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} className="h-14 rounded-xl" />
                  ))}
                </div>
              ) : categories.isError ? (
                <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
              ) : (
                <ul className="grid gap-2">
                  {(categories.data ?? []).map((category) => (
                    <li key={category.slug}>
                      <CategoryFolder category={category} level={level} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function ForYou({ overview }: { overview: ReturnType<typeof useGrammarOverview> }) {
  if (overview.isPending) return <Skeleton className="h-40 rounded-xl" />;
  // A failed recommendation must not take the library down: the whole curriculum is below.
  if (overview.isError || !overview.data) return null;

  const { recommended, continue: inProgress, weak, summary } = overview.data;
  if (recommended.length === 0 && inProgress.length === 0 && weak.length === 0) return null;

  return (
    <div className="grid gap-6">
      {recommended.length > 0 && (
        <section aria-labelledby="for-you-title">
          <SectionTitle
            id="for-you-title"
            title="Recommended for you"
            action={
              <span className="text-caption text-fg-muted">
                {summary.topics_mastered} of {summary.topics_total} mastered
              </span>
            }
          />
          <ul className="grid gap-2 sm:grid-cols-2">
            {recommended.slice(0, 4).map((item) => (
              <li key={`${item.kind}-${item.topic}-${item.rule ?? ""}`}>
                <div className="flex h-full flex-col gap-3 rounded-xl border bg-surface p-4">
                  <div className="flex items-start gap-2">
                    <Target className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium">{item.label}</p>
                      <p className="mt-0.5 text-caption text-fg-muted">{item.reason}</p>
                    </div>
                  </div>
                  <div className="mt-auto">
                    <Button size="sm" asChild>
                      <Link
                        href={
                          item.kind === "practice_rule"
                            ? `/app/grammar/${item.topic}/practice?rule=${encodeURIComponent(item.rule ?? "")}`
                            : item.kind === "compare"
                              ? `/app/grammar/${item.topic}?compare=${encodeURIComponent(item.rule ?? "")}`
                              : `/app/grammar/${item.topic}`
                        }
                      >
                        {item.kind === "practice_rule" ? "Start practice" : item.kind === "compare" ? "Compare" : "Open"}
                        <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {inProgress.length > 0 && <TopicStrip title="Continue learning" topics={inProgress} />}
        {weak.length > 0 && <TopicStrip title="Weak grammar" topics={weak} />}
      </div>
    </div>
  );
}

function TopicStrip({ title, topics }: { title: string; topics: GrammarTopicSummary[] }) {
  return (
    <section aria-label={title}>
      <SectionTitle title={title} />
      <ul className="divide-y rounded-xl border bg-surface">
        {topics.map((topic) => (
          <li key={topic.slug}>
            <TopicRow topic={topic} className="rounded-none px-4" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A category folder. Topics load on expand rather than with the page, and are grouped by
 * their band (Present / Past / Future) when the category has one — the hierarchy stops
 * there deliberately: category → group → topic, never deeper.
 */
function CategoryFolder({ category, level }: { category: GrammarCategory; level: GrammarLevelFilter }) {
  const [open, setOpen] = useState(false);
  const topics = useGrammarTopics(open ? category.slug : null, level);
  const panelId = `category-${category.slug}`;

  const groups = groupTopics(topics.data ?? []);

  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-fg-muted transition-transform duration-micro", open && "rotate-90")} aria-hidden />
        {open ? <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden /> : <Folder className="size-4 shrink-0 text-fg-muted" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body-sm font-medium">{category.name}</span>
            <span className="text-caption text-fg-muted">{category.topic_count}</span>
          </span>
          <span className="mt-0.5 block truncate text-caption text-fg-muted">{category.description}</span>
        </span>
        {category.mastery > 0 && (
          <span className="hidden w-24 shrink-0 items-center gap-2 sm:flex">
            <MasteryBar value={category.mastery} />
            <span className="text-caption text-fg-muted tabular-nums">{Math.round(category.mastery)}%</span>
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} className="border-t px-1 py-1">
          {topics.isPending ? (
            <div className="px-3 py-3">
              <InlineLoader label={`Loading ${category.name}…`} />
            </div>
          ) : topics.isError ? (
            <div className="p-3">
              <ErrorState error={topics.error} onRetry={() => void topics.refetch()} className="py-6" />
            </div>
          ) : groups.length === 0 ? (
            <p className="px-4 py-4 text-body-sm text-fg-muted">No topics at this level. Switch to All to see the rest.</p>
          ) : (
            groups.map((group) => (
              <div key={group.label || "_"}>
                {group.label && (
                  <p className="px-4 pt-3 pb-1 text-label tracking-wide text-fg-muted uppercase">{group.label}</p>
                )}
                <ul>
                  {group.topics.map((topic) => (
                    <li key={topic.slug}>
                      <TopicRow topic={topic} />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function groupTopics(topics: GrammarTopicSummary[]): { label: string; topics: GrammarTopicSummary[] }[] {
  const out: { label: string; topics: GrammarTopicSummary[] }[] = [];
  for (const topic of topics) {
    const existing = out.find((g) => g.label === topic.group);
    if (existing) existing.topics.push(topic);
    else out.push({ label: topic.group, topics: [topic] });
  }
  return out;
}

function SearchResults({
  query,
  state,
  onSuggestion,
}: {
  query: string;
  state: ReturnType<typeof useGrammarSearch>;
  onSuggestion: (s: string) => void;
}) {
  const term = query.trim();
  const showSpinner = state.pending || (state.isFetching && !state.data);

  if (showSpinner && !state.data) {
    return (
      <div className="grid gap-2" aria-busy>
        <InlineLoader label={`Searching for “${term}”…`} />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }
  if (state.isError) return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  if (!state.data) return null;

  const { results, related, suggestions } = state.data;

  if (results.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No grammar topics found"
        description={`Nothing matches “${term}”.`}
        action={
          suggestions.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => onSuggestion(s)}>
                  {s}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-6">
      <section aria-live="polite">
        <SectionTitle
          title={`${results.length} result${results.length === 1 ? "" : "s"}`}
          action={state.isFetching ? <InlineLoader label="Updating" /> : undefined}
        />
        <ul className="divide-y rounded-xl border bg-surface">
          {results.map((result) => (
            <li key={result.slug}>
              <TopicRow
                topic={result}
                highlight={term}
                className="rounded-none px-4"
                trailing={
                  result.matched_keywords.length > 0 ? (
                    <span className="hidden shrink-0 gap-1 sm:flex">
                      {result.matched_keywords.slice(0, 2).map((k) => (
                        <Badge key={k} variant="secondary">
                          {k}
                        </Badge>
                      ))}
                    </span>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      </section>

      {related.length > 0 && (
        <section aria-label="Related topics">
          <SectionTitle title="Related" />
          <ul className="divide-y rounded-xl border bg-surface">
            {related.map((topic) => (
              <li key={topic.slug}>
                <TopicRow topic={topic} className="rounded-none px-4" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
