"use client";

import { ChevronDown, Circle, CircleDashed, CircleDot, CircleSlash, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Highlight, HighlightProvider } from "@/components/common/highlight";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { ConfirmDialog, FilterBar, FilterSelect, SearchInput } from "../components/primitives";
import { useDeleteAnyGrammarContent, useGrammarMap } from "../hooks";
import { formatNumber } from "../lib/format";
import { cefrLevels } from "../types";
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
  draft: "text-warning-text",
  review: "text-warning-text",
  archived: "text-fg-disabled",
  not_applicable: "text-fg-disabled",
  // Not written yet is work to do, not something switched off: it must stay readable.
  not_created: "text-fg-muted",
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
 * There is no language filter. A topic is generated in English and translated into Uzbek
 * and Russian in the same step, so its status is the status of the English source — the
 * language every translation is made from. The builder still has a tab per language for
 * reading and fixing the translations themselves.
 */
export function GrammarMapView({ language }: { language: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [level, setLevel] = useState("all");
  const [deleting, setDeleting] = useState<MapTopic | null>(null);
  const remove = useDeleteAnyGrammarContent();

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
        <HighlightProvider query={search}>
        <div className="grid gap-3">
          {(map.data ?? []).map((category) => (
            <CategoryGroup
              key={category.slug}
              name={category.name}
              topics={category.topics}
              language={language}
              filtering={Boolean(search) || status !== "all" || level !== "all"}
              onDelete={setDeleting}
            />
          ))}
        </div>
        </HighlightProvider>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete everything written for ${deleting.name}?` : ""}
        description="The explanation in every language, the test questions, the writing and speaking tasks, the visuals and learners' progress on this topic are removed for good. If you delete it, it has to be created again from scratch. The topic itself stays in the curriculum as not created."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const name = deleting.name;
          remove.mutate(deleting.slug, {
            onSuccess: () => {
              setDeleting(null);
              toast({ title: "Deleted", description: `${name} is empty again — generate it to start over.`, variant: "success" });
            },
            onError: (error) =>
              toast({ title: "It could not be deleted", description: isApiError(error) ? error.message : undefined, variant: "error" }),
          });
        }}
      />
    </>
  );
}

function CategoryGroup({
  name,
  topics,
  language,
  filtering,
  onDelete,
}: {
  name: string;
  topics: MapTopic[];
  language: string;
  filtering: boolean;
  onDelete: (topic: MapTopic) => void;
}) {
  // Closed by default, so the page reads as a list of categories; a search or filter opens
  // every category it leaves, since the matches are what the owner came for.
  const [open, setOpen] = useState(filtering);
  const [wasFiltering, setWasFiltering] = useState(filtering);
  if (filtering !== wasFiltering) {
    setWasFiltering(filtering);
    setOpen(filtering);
  }
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
          <span className="block truncate text-h4">
            <Highlight text={name} />
          </span>
          <span className="block text-caption text-fg-muted">
            {topics.length} topics · {live} with content learners can read
          </span>
        </span>
      </button>

      {open && (
        <ul className="border-t">
          {topics.map((topic) => (
            <li key={topic.id} className="relative">
              <Link
                href={`/owner/content/grammar/${topic.slug}?lang=${language}`}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-l-2 px-4 py-3",
                  "transition-colors duration-micro last:border-b-0",
                  rowTone[topic.content.status],
                )}
              >
                <span className="grid min-w-0 flex-1 basis-64 gap-0.5">
                  <span className="truncate text-body-sm">
                    <Highlight text={topic.name} />
                  </span>
                  {topic.description && (
                    <span className="truncate text-caption text-fg-muted">
                      <Highlight text={topic.description} />
                    </span>
                  )}
                </span>
                {topic.level && <Badge variant="outline">{topic.level}</Badge>}
                <LevelDots topic={topic} />
                <span className="ml-auto flex items-center gap-2">
                  {topic.question_count > 0 && (
                    <span className="text-caption text-fg-muted tabular-nums">{topic.question_count} questions</span>
                  )}
                  <StatusPill topic={topic} />
                  {topic.content.status === "not_created" ? (
                    <Sparkles className="size-3.5 text-primary-text" aria-label="Ready to write" />
                  ) : (
                    // Room for the delete button, which sits over the row rather than inside the
                    // link: a button inside a link is two controls fighting over one click.
                    <span aria-hidden className="w-7" />
                  )}
                </span>
              </Link>
              {topic.content.status !== "not_created" && (
                <button
                  type="button"
                  onClick={() => onDelete(topic)}
                  aria-label={`Delete everything written for ${topic.name}`}
                  title="Delete content"
                  className="absolute top-1/2 right-3 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-muted outline-none transition-colors duration-micro hover:bg-error/10 hover:text-error focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
