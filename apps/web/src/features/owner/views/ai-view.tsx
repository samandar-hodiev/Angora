"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BarList } from "../components/charts";
import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import { OwnerPageHeader, SectionCard, SegmentedControl } from "../components/primitives";
import { useAIFailures, useAIQuality, useAIUsage } from "../hooks";
import { formatDateTime, formatNumber } from "../lib/format";
import type { AIFailureRow, AIQualityRow } from "../types";

/**
 * AI monitoring: what the platform spends, what fails, and what the evaluators produce.
 *
 * Cost is the gateway's own estimate recorded per call, not a projection. Scores are
 * AI-estimated and labelled as such — an AI-estimated IELTS band is not an IELTS band, and
 * grouping by prompt and rubric version is what makes a change in them visible.
 */

const activeTab = "data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border";

const rangeOptions = [
  { value: "1", label: "24H" },
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

export function OwnerAIView() {
  const [days, setDays] = useState("30");
  const numericDays = Number(days);
  const usage = useAIUsage(numericDays);

  return (
    <>
      <OwnerPageHeader
        title="AI"
        description="Usage, cost, failures and evaluation quality."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "AI" }]}
      />

      <div className="mb-5">
        <SegmentedControl label="Period" value={days} options={rangeOptions} onChange={setDays} />
      </div>

      {usage.isError ? (
        <LiveDataState error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <>
          <section aria-label="AI totals" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {usage.isPending || !usage.data
              ? Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)
              : [
                  { label: "Requests", value: formatNumber(usage.data.totals.requests), hint: `${formatNumber(usage.data.totals.failed)} failed` },
                  { label: "Estimated cost", value: `$${usage.data.totals.cost_usd.toFixed(2)}`, hint: "Recorded per call by the gateway" },
                  {
                    label: "Tokens",
                    value: formatNumber(usage.data.totals.input_tokens + usage.data.totals.output_tokens),
                    hint: `${formatNumber(usage.data.totals.input_tokens)} in · ${formatNumber(usage.data.totals.output_tokens)} out`,
                  },
                  {
                    label: "Audio",
                    value: `${Math.round(usage.data.totals.audio_seconds / 60)} min`,
                    hint: `avg latency ${Math.round(usage.data.totals.avg_latency_ms)} ms`,
                  },
                ].map((stat) => (
                  <article key={stat.label} className="grid gap-1 rounded-xl border bg-surface p-4">
                    <h3 className="text-label text-fg-muted">{stat.label}</h3>
                    <p className="text-h2 tabular-nums">{stat.value}</p>
                    <p className="text-caption text-fg-muted">{stat.hint}</p>
                  </article>
                ))}
          </section>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Cost by feature" description="Which parts of the product spend the money">
              {usage.isPending || !usage.data ? (
                <Skeleton className="h-40 w-full" />
              ) : usage.data.by_task.length === 0 ? (
                <p className="py-10 text-center text-body-sm text-fg-muted">No AI calls in this period.</p>
              ) : (
                <BarList
                  items={usage.data.by_task.map((task) => ({
                    key: task.key,
                    label: task.key.replace(/_/g, " "),
                    value: Math.round(task.cost_usd * 100),
                    display: `$${task.cost_usd.toFixed(2)}`,
                    hint: `${formatNumber(task.requests)} requests · ${formatNumber(task.failed)} failed · ${Math.round(task.avg_latency_ms)} ms`,
                  }))}
                />
              )}
            </SectionCard>

            <SectionCard title="Cost by model" description="Provider and model">
              {usage.isPending || !usage.data ? (
                <Skeleton className="h-40 w-full" />
              ) : usage.data.by_model.length === 0 ? (
                <p className="py-10 text-center text-body-sm text-fg-muted">No AI calls in this period.</p>
              ) : (
                <BarList
                  items={usage.data.by_model.map((model) => ({
                    key: model.key,
                    label: model.key,
                    value: Math.round(model.cost_usd * 100),
                    display: `$${model.cost_usd.toFixed(2)}`,
                    hint: `${formatNumber(model.requests)} requests`,
                    color: "var(--info)",
                  }))}
                />
              )}
            </SectionCard>
          </div>
        </>
      )}

      <Tabs defaultValue="failures">
        <TabsList className="mb-4">
          <TabsTrigger value="failures" className={activeTab}>Failures</TabsTrigger>
          <TabsTrigger value="quality" className={activeTab}>Evaluation quality</TabsTrigger>
        </TabsList>
        <TabsContent value="failures">
          <FailuresSection days={numericDays} />
        </TabsContent>
        <TabsContent value="quality">
          <QualitySection days={numericDays} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function FailuresSection({ days }: { days: number }) {
  const [page, setPage] = useState(1);
  const failures = useAIFailures(days, page);

  const columns: Column<AIFailureRow>[] = [
    {
      key: "when",
      header: "When",
      cell: (row) => <span className="text-fg-muted tabular-nums">{formatDateTime(row.created_at)}</span>,
    },
    { key: "task", header: "Feature", cell: (row) => <span className="font-medium">{row.task.replace(/_/g, " ")}</span> },
    {
      key: "learner",
      header: "Learner",
      hideBelow: "md",
      cell: (row) => <span className="truncate text-fg-secondary">{row.email ?? "—"}</span>,
    },
    {
      key: "model",
      header: "Model",
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-caption text-fg-muted">
          {row.provider}/{row.model}
        </span>
      ),
    },
    {
      key: "error",
      header: "Error",
      cell: (row) => (
        <Badge className="border-transparent bg-error/15 text-error">{row.error_code || row.status}</Badge>
      ),
    },
    {
      key: "latency",
      header: "Latency",
      hideBelow: "xl",
      align: "right",
      cell: (row) => <span className="tabular-nums">{row.latency_ms} ms</span>,
    },
  ];

  return (
    <SectionCard title="Failed AI calls" description={`Last ${days} days`} bodyClassName="p-0">
      {failures.isError ? (
        <div className="p-4">
          <LiveDataState error={failures.error} onRetry={() => void failures.refetch()} />
        </div>
      ) : (
        <>
          <DataTable
            caption="Failed AI requests"
            columns={columns}
            rows={failures.data?.items ?? []}
            rowKey={(row) => row.id}
            isLoading={failures.isPending}
            minWidth="56rem"
            empty={
              <p className="py-8 text-center text-body-sm text-fg-muted">
                No AI call has failed in this period.
              </p>
            }
          />
          <Pagination
            page={failures.data?.page ?? 1}
            totalPages={failures.data?.total_pages ?? 1}
            total={failures.data?.total ?? 0}
            pageSize={20}
            onPageChange={setPage}
            label="failures"
          />
        </>
      )}
    </SectionCard>
  );
}

function QualitySection({ days }: { days: number }) {
  const quality = useAIQuality(days);

  const columns: Column<AIQualityRow>[] = [
    { key: "type", header: "Analysis", cell: (row) => <span className="font-medium">{row.analysis_type}</span> },
    {
      key: "versions",
      header: "Versions",
      cell: (row) => (
        <span className="grid gap-0.5 text-caption text-fg-muted">
          <span>analysis {row.analysis_version || "—"}</span>
          <span>
            model {row.model_version || "—"} · prompt {row.prompt_version || "—"} · rubric {row.rubric_version || "—"}
          </span>
        </span>
      ),
    },
    { key: "count", header: "Results", align: "right", cell: (row) => <span className="tabular-nums">{formatNumber(row.count)}</span> },
    {
      key: "failed",
      header: "Failed",
      align: "right",
      cell: (row) => (
        <span className={row.failed > 0 ? "tabular-nums text-error" : "tabular-nums"}>{formatNumber(row.failed)}</span>
      ),
    },
    {
      key: "score",
      header: "Avg score",
      align: "right",
      cell: (row) => <span className="tabular-nums">{row.avg_score === null ? "—" : row.avg_score.toFixed(1)}</span>,
    },
  ];

  return (
    <SectionCard
      title="Evaluation quality"
      description="AI-estimated scores grouped by the versions that produced them"
      bodyClassName="p-0"
    >
      {quality.isError ? (
        <div className="p-4">
          <LiveDataState error={quality.error} onRetry={() => void quality.refetch()} />
        </div>
      ) : (
        <>
          <DataTable
            caption="AI evaluation results by version"
            columns={columns}
            rows={quality.data?.rows ?? []}
            rowKey={(row) => `${row.analysis_type}-${row.analysis_version}-${row.model_version}-${row.prompt_version}`}
            isLoading={quality.isPending}
            minWidth="52rem"
            empty={
              <p className="py-8 text-center text-body-sm text-fg-muted">
                No AI evaluations recorded yet. They appear as learners submit writing and speaking.
              </p>
            }
          />
          <p className="border-t px-4 py-3 text-caption text-fg-muted">
            These are AI-estimated scores, not official exam results. Human benchmark comparison is not implemented
            yet — when it is, it belongs beside these columns.
          </p>
        </>
      )}
    </SectionCard>
  );
}
