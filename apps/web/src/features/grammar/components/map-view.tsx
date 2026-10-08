"use client";

import { ArrowLeft, Clock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { SearchField } from "@/components/common/search-field";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrammarMapNode, GrammarTopicSummary } from "@engora/types";

import { useGrammarMap } from "../hooks";

/**
 * The grammar map.
 *
 * A hierarchical map rather than a force-directed graph: category → group → topic, readable,
 * linkable and reachable with Tab. Each topic's dot carries the learner's mastery, so the
 * whole curriculum's state is visible at once. Topics still being written are listed too —
 * muted, marked "Soon" — so the road ahead is visible; opening one says it is on its way.
 */
export function GrammarMapView() {
  const map = useGrammarMap();
  const [query, setQuery] = useState("");
  const nodes = filterMap(map.data ?? [], query);
  const total = (map.data ?? []).reduce((n, node) => n + node.groups.reduce((m, g) => m + g.topics.length, 0), 0);

  return (
    <>
      <PageHeader
        compact
        // Read once on arrival, then out of the way: the map is long, and a title pinned over
        // it would cover the very topics being scrolled to.
        pinned={false}
        title="Grammar map"
        description="The whole curriculum, and where you are in it."
        eyebrow={
          <Link href="/app/grammar" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Grammar
          </Link>
        }
      />

      {map.isPending ? (
        <div className="grid gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : map.isError ? (
        <ErrorState error={map.error} onRetry={() => void map.refetch()} />
      ) : total === 0 ? (
        <EmptyState title="The map is empty" description="Grammar topics will appear here once they are added." />
      ) : (
        <div className="grid gap-4">
          {/* The search sticks 12px under the shell header once it gets there; the title above
              scrolls away with the page. */}
          <div style={{ top: "calc(var(--app-header-h, 3.5rem) + 12px)" }} className="sticky z-20">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={`Search ${total} topics — a name, a category or a level (B1)`}
              label="Search the grammar map"
              className="min-w-0 shadow-lg"
            />
          </div>
          <Legend />

          {nodes.length === 0 ? (
            <EmptyState title="No topic matches" description={`Nothing on the map matches “${query}”. Try a shorter word.`} />
          ) : (
            nodes.map((node) => <CategorySection key={node.slug} node={node} />)
          )}
        </div>
      )}
    </>
  );
}

/** Keeps the topics whose name, group or level match; a matching category keeps all of its own. */
function filterMap(nodes: GrammarMapNode[], query: string): GrammarMapNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  return nodes
    .map((node) => {
      if (node.name.toLowerCase().includes(q)) return node;
      const groups = node.groups
        .map((g) => ({
          ...g,
          topics: g.topics.filter(
            (t) => t.name.toLowerCase().includes(q) || g.label.toLowerCase().includes(q) || (t.level ?? "").toLowerCase() === q,
          ),
        }))
        .filter((g) => g.topics.length > 0);
      return { ...node, groups };
    })
    .filter((node) => node.groups.length > 0);
}

function CategorySection({ node }: { node: GrammarMapNode }) {
  const topics = node.groups.flatMap((g) => g.topics);
  const ready = topics.filter((t) => !t.coming_soon).length;
  return (
    <section aria-labelledby={`map-${node.slug}`} className="rounded-xl border bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`map-${node.slug}`} className="text-h4">
          {node.name}
        </h2>
        <span className="text-caption text-fg-muted tabular-nums">
          {ready} of {topics.length} ready
        </span>
      </header>
      {node.groups.length === 1 && !node.groups[0]!.label ? (
        // One unlabelled group: its topics flow into as many columns as fit, instead of one
        // narrow column with two thirds of the card empty beside it.
        <ul className="mt-3 gap-x-6 [column-width:17rem]">
          {node.groups[0]!.topics.map((topic) => (
            <li key={topic.slug} className="min-w-0 break-inside-avoid">
              <MapTopic topic={topic} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-6 gap-y-4">
          {node.groups.map((group) => (
            <div key={group.label || "_"} className="grid min-w-0 content-start gap-1.5">
              {group.label && <p className="text-label tracking-wide text-fg-muted uppercase">{group.label}</p>}
              <ul className="grid min-w-0 gap-0.5 border-l pl-3">
                {group.topics.map((topic) => (
                  <li key={topic.slug} className="min-w-0">
                    <MapTopic topic={topic} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MapTopic({ topic }: { topic: GrammarTopicSummary }) {
  const soon = Boolean(topic.coming_soon);
  return (
    <Link
      href={`/app/grammar/${topic.slug}`}
      title={
        soon
          ? `${topic.name} — being prepared, coming soon`
          : topic.mastery > 0
            ? `${topic.name} — ${Math.round(topic.mastery)}% mastery`
            : topic.name
      }
      className="flex items-center gap-2 rounded-md px-2 py-1 text-body-sm outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {soon ? (
        <Clock className="size-3 shrink-0 text-warning-text" aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            topic.state === "mastered"
              ? "bg-success"
              : topic.mastery >= 50
                ? "bg-primary"
                : topic.mastery > 0
                  ? "bg-warning"
                  : "bg-border",
          )}
        />
      )}
      {/* The muted colour sits on the name, not the link: cn() would drop text-body-sm for it. */}
      <span className={cn("min-w-0 flex-1 truncate", soon && "text-fg-muted")}>{topic.name}</span>
      {soon && (
        <span className="shrink-0 rounded bg-warning/15 px-1.5 text-[0.625rem] font-semibold tracking-wide text-warning-text uppercase">
          Soon
        </span>
      )}
      <span className="w-6 shrink-0 text-right text-caption text-fg-muted">{topic.level}</span>
    </Link>
  );
}

function Legend() {
  const items = [
    { className: "bg-border", label: "Not started" },
    { className: "bg-warning", label: "Started" },
    { className: "bg-primary", label: "Developing" },
    { className: "bg-success", label: "Mastered" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-caption text-fg-muted">
          <span aria-hidden className={cn("size-2 rounded-full", item.className)} />
          {item.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5 text-caption text-fg-muted">
        <Clock className="size-3 text-warning-text" aria-hidden />
        Coming soon
      </li>
    </ul>
  );
}
