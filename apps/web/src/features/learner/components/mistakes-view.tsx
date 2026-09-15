"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { MistakeCard } from "@/components/learning/cards";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanize } from "@/lib/learning-format";

import { useMistakes, useMistakeSummary } from "../hooks";
import { Pagination } from "./pagination";

export function MistakesView() {
  const summary = useMistakeSummary();
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const list = useMistakes(group, page);

  if (summary.isPending) {
    return (
      <>
        <PageHeader title="My Mistakes" />
        <Skeleton className="h-64 rounded-xl" />
      </>
    );
  }
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;

  const s = summary.data;
  if (s.total === 0) {
    return (
      <>
        <PageHeader title="My Mistakes" />
        <EmptyState
          icon={ListChecks}
          title="No mistakes yet"
          description="Complete your first practice and your personalised mistakes will appear here."
          action={
            <Button asChild>
              <Link href="/app/learn">Start practising</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="My Mistakes" description="Fix patterns, not single slips. Repeated mistakes are shown first." />

      <section aria-label="Mistakes by type" className="grid gap-4 sm:grid-cols-3">
        {s.groups.map((g) => (
          <button
            key={g.group}
            onClick={() => {
              setGroup(g.group === group ? "" : g.group);
              setPage(1);
            }}
            aria-pressed={group === g.group}
            className="grid gap-1 rounded-lg border bg-surface p-4 text-left outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-pressed:border-primary aria-pressed:bg-primary-subtle"
          >
            <span className="text-label text-fg-muted">{humanize(g.group)}</span>
            <span className="text-h1 tabular-nums">{g.count}</span>
          </button>
        ))}
      </section>

      {s.patterns.length > 0 && (
        <section aria-labelledby="patterns-title" className="mt-10">
          <SectionTitle id="patterns-title" title="Repeated mistakes" />
          <div className="grid gap-4 md:grid-cols-2">
            {s.patterns.map((pt) => (
              <MistakeCard
                key={pt.category + pt.correction}
                category={pt.category}
                original={pt.example}
                correction={pt.correction}
                explanation={pt.explanation}
                occurrences={pt.occurrences}
                action={
                  pt.category.startsWith("grammar") ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/app/grammar">Practice</Link>
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="recent-title" className="mt-10">
        <SectionTitle id="recent-title" title="All mistakes" />
        <Tabs
          value={group || "all"}
          onValueChange={(v) => {
            setGroup(v === "all" ? "" : v);
            setPage(1);
          }}
          className="mb-4"
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {s.groups.map((g) => (
              <TabsTrigger key={g.group} value={g.group}>
                {humanize(g.group)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {list.isPending ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {list.data.items.map((m) => (
                <MistakeCard key={m.id} category={m.category} original={m.original} correction={m.correction} explanation={m.explanation} severity={m.severity} />
              ))}
            </div>
            <Pagination page={page} pageSize={20} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
