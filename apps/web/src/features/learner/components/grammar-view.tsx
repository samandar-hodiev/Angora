"use client";

import { Shapes } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Tooltip } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useGrammarTopics } from "../hooks";

export function GrammarView() {
  const topics = useGrammarTopics();
  const [weakestFirst, setWeakestFirst] = useState(false);

  const sorted = useMemo(() => {
    const list = [...(topics.data ?? [])];
    return weakestFirst ? list.sort((a, b) => a.mastery - b.mastery) : list;
  }, [topics.data, weakestFirst]);

  return (
    <>
      <PageHeader
        title="Grammar"
        description="Topics ranked by level, with your mastery from practice and mistakes."
        actions={
          <div role="group" aria-label="Sort topics" className="inline-flex rounded-lg border bg-surface p-1">
            {[
              { label: "By level", value: false },
              { label: "Weakest first", value: true },
            ].map((opt) => (
              <button
                key={opt.label}
                aria-pressed={weakestFirst === opt.value}
                onClick={() => setWeakestFirst(opt.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-label transition-colors duration-micro",
                  weakestFirst === opt.value ? "bg-surface-active text-foreground" : "text-fg-muted hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />
      {topics.isPending ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : topics.isError ? (
        <ErrorState error={topics.error} onRetry={() => void topics.refetch()} />
      ) : sorted.length === 0 ? (
        <EmptyState icon={Shapes} title="No grammar topics yet" description="Topics will appear as soon as they are published." />
      ) : (
        <ul className="divide-y rounded-xl border bg-surface">
          {sorted.map((topic) => {
            const weak = topic.attempts > 0 && topic.mastery < 50;
            return (
              <li key={topic.slug} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-h4">{topic.name}</p>
                    {topic.level && <Badge variant="outline">{topic.level}</Badge>}
                    {weak && <Badge variant="warning">Needs work</Badge>}
                  </div>
                  <p className="text-body-sm text-fg-muted">{topic.description}</p>
                </div>
                <Meter
                  label={topic.attempts > 0 ? `${topic.attempts} attempts` : "Not practised"}
                  value={topic.mastery}
                  tone={weak ? "warning" : topic.mastery >= 80 ? "success" : "primary"}
                />
                <Tooltip content="Grammar exercises arrive with the grammar release.">
                  <span tabIndex={0}>
                    <Button variant={weak ? "default" : "outline"} size="sm" disabled>
                      Practice
                    </Button>
                  </span>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
