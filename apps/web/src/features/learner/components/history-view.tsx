"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { humanize, timeAgo } from "@/lib/learning-format";

import { useHistory } from "../hooks";
import { Pagination } from "./pagination";

export function HistoryView() {
  const [page, setPage] = useState(1);
  const history = useHistory(page);

  return (
    <>
      <PageHeader title="History" description="Every session, submission and attempt — from web and mobile." />
      {history.isPending ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data.items.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing here yet"
          description="Your practice history will build up as you learn."
          action={
            <Button asChild>
              <Link href="/app/learn">Start practising</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-surface">
            {history.data.items.map((item) => (
              <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4">
                <span className="grid size-9 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                  <SkillIcon code={item.kind} className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-h4">{item.title}</p>
                  <p className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
                    <span className="capitalize">{item.kind}</span>·<span>{timeAgo(item.created_at)}</span>
                    {item.mode !== "practice" && <Badge variant="outline">{humanize(item.mode)}</Badge>}
                  </p>
                </div>
                <div className="grid justify-items-end gap-1">
                  {item.score !== null && (
                    <span className="text-h4 tabular-nums">{item.kind === "reading" || item.kind === "listening" ? `${Math.round(item.score)}%` : item.score.toFixed(1)}</span>
                  )}
                  <Badge variant={item.status === "completed" ? "success" : "secondary"}>{humanize(item.status)}</Badge>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={20} total={history.data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
