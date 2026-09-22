"use client";

import { ChevronDown, Circle, CircleDashed, CircleDot, CircleSlash, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { FilterBar, FilterSelect, SearchInput } from "../components/primitives";
import { useGrammarMap } from "../hooks";
import { formatNumber } from "../lib/format";
import { cefrLevels, contentLanguages, contentLanguageLabels } from "../types";
import type { ContentStatusState, LevelStatus, MapTopic } from "../types";

/**
 * The Grammar Map: the curriculum, and how much of it has been written.
 *
 * The map exists whether or not anybody has authored anything — a topic with no content is
 * the normal starting state, not an error and not something to hide. That is the point of
 * the page: an owner should be able to see, at a glance, which parts of English grammar
 * learners can actually study and which are still waiting.
 *
 * Nothing here is hardcoded. Categories, topics, their order and their status all come from
 * the database, so adding a topic to the curriculum makes it appear here without a deploy.
 */

const statusOptions = [
  { value: "all", label: "Every topic" },
  { value: "not_created", label: "Not created" },
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "partially_published", label: "Partially published" },
  { value: "published", label: "Published" },
];

const statusLabels: Record<ContentStatusState, string> = {
  not_created: "Not created",
  draft: "Draft",
  in_review: "In review",
  partially_published: "Partially published",
  published: "Published",
  not_applicable: "Not applicable",
};

/**
 * A row's colour answers one question: can a learner read this today?
 *
 * Green means yes. Everything else is grey — never written, half written, waiting for review
 * are three different jobs for an owner but the same nothing for a learner, and the row
 * should not claim otherwise. The badge is where the difference is spelled out.
 */
const rowTone: Record<ContentStatusState, string> = {
  published: "border-l-success bg-success/[0.08] hover:bg-success/[0.14]",
  partially_published: "border-l-success/50 bg-success/[0.04] hover:bg-success/[0.1]",
  draft: "border-l-border bg-surface-active/45 hover:bg-surface-active/75",
  in_review: "border-l-border bg-surface-active/45 hover:bg-surface-active/75",
  not_created: "border-l-border bg-surface-active/25 hover:bg-surface-active/55",
  not_applicable: "border-l-border bg-surface-active/25 hover:bg-surface-active/55",
};

/** Grey, and readable on both themes: a badge that has to look inert still has to be legible. */
const mutedBadge = "border-transparent bg-fg-muted/15 text-fg-muted";

/** Published is the only state that means a learner can read it, so it is the only green one. */
function StatusPill({ topic }: { topic: MapTopic }) {
  const { status, published_levels: published, total_levels: total } = topic.content;

  if (status === "published") {
    return <Badge variant="success">Published</Badge>;
  }
  if (status === "partially_published") {
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        {published}/{total} levels live
      </Badge>
    );
  }
  if (status === "not_created") {
    return <Badge className={mutedBadge}>Not created</Badge>;
  }
  return <Badge className={mutedBadge}>{statusLabels[status]}</Badge>;
}

const levelIcon: Record<LevelStatus, typeof Circle> = {
  published: CircleDot,
  draft: CircleDashed,
  review: CircleDashed,
  archived: Circle,
  not_applicable: CircleSlash,
  not_created: Circle,
};

const levelTone: Record<LevelStatus, string> = {
  published: "text-success",
  draft: "text-warning",
  review: "text-warning",
  archived: "text-fg-disabled",
  not_applicable: "text-fg-disabled",
  not_created: "text-fg-disabled",
};

/** Six dots, one per CEFR level. A topic does not have to be taught at all six — the ones
 *  ruled out are struck through rather than left looking unfinished. */
function LevelDots({ topic }: { topic: MapTopic }) {
  return (
    <span className="flex items-center gap-1" aria-label="Levels">
      {topic.levels.map((level) => {
        const Icon = levelIcon[level.status];
        return (
          <span key={level.level} className="flex items-center gap-0.5" title={`${level.level}: ${level.status.replace(/_/g, " ")}`}>
            <Icon className={cn("size-3", levelTone[level.status])} aria-hidden />
            <span className={cn("text-[0.625rem] tabular-nums", levelTone[level.status])}>{level.level}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * The language lives above this component because the schema dialog reads it too: "written"
 * means written in the language you are looking at, and two controls disagreeing about that
 * would make the same topic green in one place and grey in the other.
 */
export function GrammarMapView({
  language,
  onLanguageChange,
}: {
  language: string;
  onLanguageChange: (language: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [level, setLevel] = useState("all");

  const query = useMemo(
    () => ({ lang: language, search, status, level }),
    [language, search, status, level],
  );
  const map = useGrammarMap(query);

  const totals = useMemo(() => {
    const topics = (map.data ?? []).flatMap((category) => category.topics);
    return {
      topics: topics.length,
      written: topics.filter((t) => t.content.status !== "not_created").length,
      live: topics.filter(
        (t) => t.content.status === "published" || t.content.status === "partially_published",
      ).length,
    };
  }, [map.data]);

  return (
    <>
      <FilterBar
        onReset={() => {
          setSearch("");
          setStatus("all");
          setLevel("all");
        }}
        resultLabel={
          map.isPending
            ? undefined
            : `${formatNumber(totals.live)} of ${formatNumber(totals.topics)} topics live`
        }
      >
        <SearchInput label="Search grammar topics" value={search} onChange={setSearch} placeholder="Search grammar topics…" />
        <FilterSelect label="Content" value={status} options={statusOptions} onChange={setStatus} />
        <FilterSelect
          label="Level"
          value={level}
          options={[{ value: "all", label: "All levels" }, ...cefrLevels.map((code) => ({ value: code, label: code }))]}
          onChange={setLevel}
        />
        <FilterSelect
          label="Language"
          value={language}
          options={contentLanguages.map((code) => ({ value: code, label: contentLanguageLabels[code] }))}
          onChange={onLanguageChange}
        />
      </FilterBar>

      {map.isError ? (
        <LiveDataState error={map.error} onRetry={() => void map.refetch()} />
      ) : map.isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : (map.data ?? []).length === 0 ? (
        <p className="rounded-xl border bg-surface py-12 text-center text-body-sm text-fg-muted">
          No grammar topic matches these filters.
        </p>
      ) : (
        <div className="grid gap-3">
          {(map.data ?? []).map((category) => (
            <CategoryGroup key={category.slug} name={category.name} topics={category.topics} language={language} />
          ))}
        </div>
      )}
    </>
  );
}

function CategoryGroup({ name, topics, language }: { name: string; topics: MapTopic[]; language: string }) {
  const [open, setOpen] = useState(true);
  const live = topics.filter(
    (t) => t.content.status === "published" || t.content.status === "partially_published",
  ).length;

  return (
    <section className="rounded-xl border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform duration-micro", !open && "-rotate-90")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-h4">{name}</span>
          <span className="block text-caption text-fg-muted">
            {topics.length} topics · {live} with content learners can read
          </span>
        </span>
      </button>

      {open && (
        <ul className="border-t">
          {topics.map((topic) => (
            <li key={topic.id}>
              <Link
                href={`/owner/content/grammar/${topic.slug}?lang=${language}`}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-l-2 px-4 py-3",
                  "transition-colors duration-micro last:border-b-0",
                  rowTone[topic.content.status],
                )}
              >
                <span className="grid min-w-0 flex-1 basis-64 gap-0.5">
                  <span className="truncate text-body-sm">{topic.name}</span>
                  {topic.description && (
                    <span className="truncate text-caption text-fg-muted">{topic.description}</span>
                  )}
                </span>
                {topic.level && <Badge variant="outline">{topic.level}</Badge>}
                <LevelDots topic={topic} />
                <span className="ml-auto flex items-center gap-2">
                  {topic.question_count > 0 && (
                    <span className="text-caption text-fg-muted tabular-nums">{topic.question_count} questions</span>
                  )}
                  <StatusPill topic={topic} />
                  {topic.content.status === "not_created" && (
                    <Sparkles className="size-3.5 text-primary" aria-label="Ready to write" />
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
