"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrammarTopicSummary } from "@engora/types";

import { useGrammarMap } from "../hooks";

/**
 * The grammar map.
 *
 * A hierarchical map rather than a force-directed graph. A physics simulation of 149 nodes
 * looks impressive and answers none of the questions a learner actually has — where am I,
 * what have I done, what comes next — while costing a canvas, a layout engine and a
 * keyboard-navigation problem. This is a tree: readable, linkable, and reachable with Tab.
 *
 * Each topic's dot carries its mastery, so the whole curriculum's state is visible at once.
 */
export function GrammarMapView() {
  const map = useGrammarMap();

  return (
    <>
      <PageHeader
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
      ) : (map.data ?? []).length === 0 ? (
        <EmptyState title="The map is empty" description="Grammar topics will appear here once they are published." />
      ) : (
        <>
          <Legend />
          <div className="mt-4 grid gap-4">
            {(map.data ?? []).map((node) => (
              <section key={node.slug} aria-labelledby={`map-${node.slug}`} className="rounded-xl border bg-surface p-5">
                <h2 id={`map-${node.slug}`} className="text-h4">
                  {node.name}
                </h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {node.groups.map((group) => (
                    <div key={group.label || "_"} className="grid gap-1.5">
                      {group.label && (
                        <p className="text-label tracking-wide text-fg-muted uppercase">{group.label}</p>
                      )}
                      <ul className="grid gap-0.5 border-l pl-3">
                        {group.topics.map((topic) => (
                          <li key={topic.slug}>
                            <MapTopic topic={topic} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function MapTopic({ topic }: { topic: GrammarTopicSummary }) {
  return (
    <Link
      href={`/app/grammar/${topic.slug}`}
      title={topic.mastery > 0 ? `${topic.name} — ${Math.round(topic.mastery)}% mastery` : topic.name}
      className="flex items-center gap-2 rounded-md px-2 py-1 text-body-sm outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
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
      <span className="min-w-0 flex-1 truncate">{topic.name}</span>
      <span className="shrink-0 text-caption text-fg-muted">{topic.level}</span>
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
    <ul className="flex flex-wrap gap-x-4 gap-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-caption text-fg-muted">
          <span aria-hidden className={cn("size-2 rounded-full", item.className)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
