"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BarList } from "../components/charts";
import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import { OwnerPageHeader, SectionCard, SegmentedControl } from "../components/primitives";
import { AISpendChart, ProviderMark, formatUSD } from "../components/ai-spend-chart";
import { useAIFailures, useAIQuality, useAITimeline } from "../hooks";
import { TeamActivity } from "./team-activity";
import { formatDateTime, formatNumber } from "../lib/format";
import type { AIFailureRow, AIQualityRow } from "../types";

/**
 * AI & Team Activity: what the AI costs, per provider and over time, and what every member of
 * the team did to the content (see team-activity.tsx). Opens on the AI numbers.
 *
 * AI monitoring: what the platform spends, what fails, and what the evaluators produce.
 *
 * Cost is the gateway's own estimate recorded per call, not a projection. Scores are
 * AI-estimated and labelled as such — an AI-estimated IELTS band is not an IELTS band, and
 * grouping by prompt and rubric version is what makes a change in them visible.
 */

const activeTab = "data-[state=active]:text-primary-text data-[state=active]:ring-1 data-[state=active]:ring-border";

const rangeOptions = [
  { value: "1", label: "24H" },
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

export function OwnerAIView() {
  const [days, setDays] = useState("7");
  const [view, setView] = useState<"ai" | "team">("ai");
  const numericDays = Number(days);

  return (
    <>
      <OwnerPageHeader
        title="AI & Team Activity"
        description="What the AI costs, provider by provider — and what every member of the team did to the content."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "AI & Team Activity" }]}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="View"
          value={view}
          options={[
            { value: "ai", label: "AI usage" },
            { value: "team", label: "Team activity" },
          ]}
          onChange={setView}
        />
        <SegmentedControl label="Period" value={days} options={rangeOptions} onChange={setDays} />
      </div>

      {view === "ai" ? <AIUsage days={numericDays} /> : <TeamActivity days={numericDays} />}
    </>
  );
}

function AIUsage({ days }: { days: number }) {
  const timeline = useAITimeline(days);
  const data = timeline.data;

  if (timeline.isError) return <LiveDataState error={timeline.error} onRetry={() => void timeline.refetch()} />;

  const models = (data?.providers ?? []).flatMap((p) => (p.models ?? []).map((m) => ({ ...m, provider: p.provider })));

  return (
    <>
      <section aria-label="AI totals" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!data
          ? Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)
          : [
              { label: "Requests", value: formatNumber(data.totals.requests), hint: `${formatNumber(data.totals.failed)} failed` },
              { label: "Cost", value: formatUSD(data.totals.cost_usd), hint: "From tokens used × each model's price" },
              {
                label: "Tokens",
                value: formatNumber(data.totals.input_tokens + data.totals.output_tokens),
                hint: `${formatNumber(data.totals.input_tokens)} in · ${formatNumber(data.totals.output_tokens)} out`,
              },
              {
                label: "Providers",
                value: formatNumber(data.providers.length),
                hint: `${Math.round(data.totals.audio_seconds / 60)} min of audio transcribed`,
              },
            ].map((stat) => (
              <article key={stat.label} className="grid gap-1 rounded-xl border bg-surface p-4">
                <h3 className="text-label text-fg-muted">{stat.label}</h3>
                <p className="text-h2 tabular-nums">{stat.value}</p>
                <p className="text-caption text-fg-muted">{stat.hint}</p>
              </article>
            ))}
      </section>

      <SectionCard
        title="AI spend over time"
        description={`Tokens and dollars per provider · ${data?.bucket === "hour" ? "by hour" : "by day"} — switch a provider off to compare the rest`}
        className="mb-6"
      >
        {!data ? <Skeleton className="h-72 w-full" /> : <AISpendChart timeline={data} />}
      </SectionCard>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Cost by feature" description="Which parts of the product spend the money">
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.tasks.length === 0 ? (
            <p className="py-10 text-center text-body-sm text-fg-muted">No AI calls in this period.</p>
          ) : (
            <BarList
              items={data.tasks.map((task) => ({
                key: task.task || "other",
                label: (task.task || "other").replace(/_/g, " "),
                value: Math.max(1, Math.round(task.cost_usd * 10000)),
                display: formatUSD(task.cost_usd),
                hint: `${formatNumber(task.requests)} requests · ${formatNumber(task.tokens)} tokens · ${formatNumber(task.failed)} failed`,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard title="Cost by model" description="Provider and model">
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : models.length === 0 ? (
            <p className="py-10 text-center text-body-sm text-fg-muted">No AI calls in this period.</p>
          ) : (
            <ul className="grid gap-2">
              {models
                .sort((x, y) => y.cost_usd - x.cost_usd)
                .map((m) => (
                  <li key={`${m.provider}/${m.model}`} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                    <ProviderMark provider={m.provider} index={data.providers.findIndex((p) => p.provider === m.provider)} />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-body-sm font-medium">{m.model || "—"}</span>
                      <span className="text-caption text-fg-muted">
                        {formatNumber(m.requests)} requests · {formatNumber(m.tokens)} tokens
                        {!m.priced && " · no price set"}
                      </span>
                    </span>
                    <span className="text-body-sm font-semibold tabular-nums">{formatUSD(m.cost_usd)}</span>
                  </li>
                ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <Tabs defaultValue="failures">
        <TabsList className="mb-4">
          <TabsTrigger value="failures" className={activeTab}>
            Failures
          </TabsTrigger>
          <TabsTrigger value="quality" className={activeTab}>
            Evaluation quality
          </TabsTrigger>
        </TabsList>
        <TabsContent value="failures">
          <FailuresSection days={days} />
        </TabsContent>
        <TabsContent value="quality">
          <QualitySection days={days} />
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
