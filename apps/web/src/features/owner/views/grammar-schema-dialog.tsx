"use client";

import { Circle, PenLine, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { useGrammarMap } from "../hooks";
import { formatNumber } from "../lib/format";
import type { MapCategory, MapTopic } from "../types";

/**
 * The curriculum as a schema, for deciding what to write next.
 *
 * The Grammar Map lists topics; this shows their shape. A category is a station on a spine,
 * its ring filled in proportion to how much of it has been written, and every topic hangs off
 * it as a node — solid green once it carries content, dashed grey while it is still only a
 * plan. Nothing is authored here: each node is a door into the builder, which is the whole
 * point of opening this from "Create content".
 *
 * The curriculum is 150 topics, so the schema scrolls. It is built from the same live map the
 * page behind it reads — no second source, nothing hardcoded.
 */

/** A topic counts as written the moment any level carries content, published or not. */
function isWritten(topic: MapTopic): boolean {
  return topic.content.status !== "not_created";
}

export function GrammarSchemaDialog({
  open,
  onOpenChange,
  language,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: string;
}) {
  const [search, setSearch] = useState("");

  // Only fetched once the dialog is opened; the page behind it already has its own map.
  const query = useMemo(() => ({ lang: language }), [language]);
  const map = useGrammarMap(query, { enabled: open });

  const categories = useMemo(() => {
    const term = search.trim().toLowerCase();
    const source = map.data ?? [];
    if (!term) return source;
    return source
      .map((category) => ({
        ...category,
        topics: category.name.toLowerCase().includes(term)
          ? category.topics
          : category.topics.filter(
              (topic) =>
                topic.name.toLowerCase().includes(term) || topic.description.toLowerCase().includes(term),
            ),
      }))
      .filter((category) => category.topics.length > 0);
  }, [map.data, search]);

  const totals = useMemo(() => {
    const topics = (map.data ?? []).flatMap((category) => category.topics);
    return { topics: topics.length, written: topics.filter(isWritten).length };
  }, [map.data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86vh,54rem)] w-[min(72rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="grid gap-3 border-b px-6 pt-6 pb-4 text-left">
          <div className="grid gap-1 pr-10">
            <DialogTitle className="text-h3">Create content</DialogTitle>
            <DialogDescription>
              The grammar curriculum, as a map of what is written and what is not. Pick a node to open the
              builder for that topic.
            </DialogDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a topic or category…"
                aria-label="Search the curriculum"
                className="h-10 rounded-xl pl-9"
              />
            </div>
            <Legend />
            {!map.isPending && (
              <span className="text-caption text-fg-muted tabular-nums">
                {formatNumber(totals.written)} of {formatNumber(totals.topics)} written
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {map.isError ? (
            <LiveDataState error={map.error} onRetry={() => void map.refetch()} />
          ) : map.isPending ? (
            <div className="grid gap-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : categories.length === 0 ? (
            <p className="py-16 text-center text-body-sm text-fg-muted">Nothing in the curriculum matches “{search}”.</p>
          ) : (
            <ol className="grid">
              {categories.map((category, index) => (
                <Branch
                  key={category.slug}
                  category={category}
                  index={index}
                  last={index === categories.length - 1}
                  language={language}
                  onPick={() => onOpenChange(false)}
                />
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Legend() {
  return (
    <span className="flex items-center gap-3 text-caption text-fg-muted">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-success" aria-hidden />
        Written
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border border-dashed border-fg-muted" aria-hidden />
        Not created
      </span>
    </span>
  );
}

/**
 * One category: a station on the spine, with its topics branching off it.
 *
 * The ring around the number is the category's own progress, drawn from the data rather than
 * described in words — a half-filled ring says "half of this is written" faster than a count
 * does, and the count is there underneath for when the exact number matters.
 */
function Branch({
  category,
  index,
  last,
  language,
  onPick,
}: {
  category: MapCategory;
  index: number;
  last: boolean;
  language: string;
  onPick: () => void;
}) {
  const written = category.topics.filter(isWritten).length;
  const percent = category.topics.length === 0 ? 0 : Math.round((written / category.topics.length) * 100);
  const complete = written === category.topics.length && written > 0;

  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3">
      <div className="relative flex flex-col items-center">
        {/* The spine. It stops at the last station rather than trailing into nothing. */}
        {!last && <span className="absolute top-10 bottom-0 w-px bg-fg-muted/30" aria-hidden />}
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--success) ${percent}%, color-mix(in oklab, var(--text-muted) 30%, transparent) 0)`,
          }}
          aria-hidden
        >
          <span className="grid size-[2.125rem] place-items-center rounded-full bg-surface text-caption font-semibold tabular-nums">
            {complete ? <Sparkles className="size-4 text-success" /> : index + 1}
          </span>
        </span>
      </div>

      <div className={cn("min-w-0", last ? "pb-1" : "pb-7")}>
        {/* The connector: this panel is attached to the station, not merely near it. */}
        <div className="relative rounded-xl border bg-surface/60 p-3">
          <span className="absolute top-[1.25rem] -left-3 w-3 border-t border-dashed border-fg-muted/40" aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="truncate text-body-sm font-medium">{category.name}</h3>
            <span className="text-caption text-fg-muted tabular-nums">
              {written}/{category.topics.length} written
            </span>
          </div>

          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {category.topics.map((topic) => (
              <li key={topic.id}>
                <TopicNode topic={topic} language={language} onPick={onPick} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

function TopicNode({ topic, language, onPick }: { topic: MapTopic; language: string; onPick: () => void }) {
  const written = isWritten(topic);
  const live = topic.content.status === "published" || topic.content.status === "partially_published";

  return (
    <Link
      href={`/owner/content/grammar/${topic.slug}?lang=${language}`}
      onClick={onPick}
      title={`${topic.name} — ${written ? topic.content.status.replace(/_/g, " ") : "not created"}`}
      className={cn(
        "group inline-flex max-w-[18rem] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-caption transition-colors duration-micro",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        written
          ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
          : "border-dashed border-border bg-surface-active/40 text-fg-secondary hover:border-primary/50 hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {written ? (
        <Circle className={cn("size-2.5 shrink-0", live ? "fill-success text-success" : "text-success")} aria-hidden />
      ) : (
        <PenLine className="size-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
      )}
      <span className="truncate">{topic.name}</span>
      {topic.level && <span className="shrink-0 text-[0.625rem] opacity-70 tabular-nums">{topic.level}</span>}
    </Link>
  );
}
