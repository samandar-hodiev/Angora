"use client";

import { CheckCircle2, ClipboardList, Clock, Layers } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";

import { BarList } from "../components/charts";
import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import {
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  LevelBadge,
  OwnerPageHeader,
  SectionCard,
} from "../components/primitives";
import {
  useActivateAssessmentConfig,
  useAssessmentAttempts,
  useAssessmentConfigs,
  useAssessmentStats,
  useCreateAssessmentConfig,
} from "../hooks";
import { formatDateTime, formatNumber } from "../lib/format";
import type { AssessmentAttempt, AssessmentConfig, AttemptStatus, CEFRLevel } from "../types";
import { cefrLevels } from "../types";

const activeTab = "data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border";

const attemptStatusStyles: Record<AttemptStatus, string> = {
  completed: "border-transparent bg-success/15 text-success",
  in_progress: "border-transparent bg-info/15 text-info",
  processing: "border-transparent bg-info/15 text-info",
  failed: "border-transparent bg-error/15 text-error",
  abandoned: "border-transparent bg-surface-active text-fg-muted",
};

const attemptStatusLabels: Record<AttemptStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  processing: "Scoring",
  failed: "Failed",
  abandoned: "Abandoned",
};

/**
 * Placement and assessment management.
 *
 * Three questions, in the order an owner asks them: is the test working (stats), what shape is
 * it (configs), and who took it (attempts). All three read the same tables the learner
 * assessment service writes — there is no reporting copy of this data.
 */
export function AssessmentsView() {
  const [days, setDays] = useState(90);

  return (
    <>
      <OwnerPageHeader
        title="Assessments"
        description="Placement configuration, live results and the question bank behind them."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Assessments" }]}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/owner/content/question-bank">
              <ClipboardList aria-hidden />
              Question bank
            </Link>
          </Button>
        }
      />

      <StatsSection days={days} onDaysChange={setDays} />

      <Tabs defaultValue="configs" className="mt-6">
        <TabsList className="mb-4">
          <TabsTrigger value="configs" className={activeTab}>
            <Layers className="size-4" aria-hidden />
            Test configuration
          </TabsTrigger>
          <TabsTrigger value="attempts" className={activeTab}>
            <Clock className="size-4" aria-hidden />
            Attempts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="configs">
          <ConfigsSection />
        </TabsContent>
        <TabsContent value="attempts">
          <AttemptsSection days={days} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StatsSection({ days, onDaysChange }: { days: number; onDaysChange: (days: number) => void }) {
  const stats = useAssessmentStats(days);

  if (stats.isError) {
    return (
      <SectionCard title="Placement results" description="Live from the platform database">
        <LiveDataState error={stats.error} onRetry={() => void stats.refetch()} />
      </SectionCard>
    );
  }

  const data = stats.data;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Period"
          value={String(days)}
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "365", label: "Last 12 months" },
          ]}
          onChange={(value) => onDaysChange(Number(value))}
        />
        <span className="text-caption text-fg-muted">Counted from assessments, not estimated.</span>
      </div>

      <section aria-label="Assessment outcomes" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.isPending || !data
          ? Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)
          : [
              { label: "Started", value: formatNumber(data.started), hint: `${formatNumber(data.in_progress)} still open` },
              {
                label: "Completed",
                value: formatNumber(data.completed),
                hint: `${data.completion_rate.toFixed(1)}% completion rate`,
              },
              {
                label: "Median duration",
                value: data.median_minutes === null ? "—" : `${data.median_minutes.toFixed(0)} min`,
                hint: "Start to result, completed attempts",
              },
              {
                label: "Dropped",
                value: formatNumber(data.abandoned + data.failed),
                hint: `${formatNumber(data.abandoned)} abandoned · ${formatNumber(data.failed)} failed`,
              },
            ].map((metric) => (
              <article key={metric.label} className="grid gap-1 rounded-xl border bg-surface p-4">
                <h3 className="text-label text-fg-muted">{metric.label}</h3>
                <p className="text-h2 tabular-nums">{metric.value}</p>
                <p className="text-caption text-fg-muted">{metric.hint}</p>
              </article>
            ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Assessed level distribution" description="Where placement puts learners">
          {stats.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.level_distribution.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-fg-muted">
              No completed assessments in this period yet.
            </p>
          ) : (
            <BarList
              items={data.level_distribution.map((bucket) => ({
                key: bucket.key,
                label: bucket.key,
                value: bucket.count,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard title="Average score per skill" description="From assessment_skill_results">
          {stats.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.by_skill.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-fg-muted">No skill results in this period yet.</p>
          ) : (
            <BarList
              items={data.by_skill.map((skill) => ({
                key: skill.skill,
                label: skill.skill.charAt(0).toUpperCase() + skill.skill.slice(1),
                value: Math.round(skill.avg_score),
                display: `${skill.avg_score.toFixed(1)} / 100`,
                hint: `${formatNumber(skill.results)} results · confidence ${skill.avg_confidence.toFixed(2)}`,
              }))}
            />
          )}
        </SectionCard>
      </div>
    </>
  );
}

function ConfigsSection() {
  const configs = useAssessmentConfigs();
  const activate = useActivateAssessmentConfig();
  const [pending, setPending] = useState<AssessmentConfig | null>(null);

  if (configs.isError) {
    return (
      <SectionCard title="Test configuration" description="Versioned section plans">
        <LiveDataState error={configs.error} onRetry={() => void configs.refetch()} />
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard
        title="Test configuration"
        description="Each version is immutable; exactly one per kind is active"
      >
        {configs.isPending ? (
          <div className="grid gap-2">
            {Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        ) : (configs.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-body-sm text-fg-muted">No assessment configuration exists yet.</p>
        ) : (
          <ul className="grid gap-3">
            {configs.data?.map((config) => (
              <li key={config.id} className="grid gap-3 rounded-lg border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize">{config.kind}</span>
                  <Badge variant="outline">v{config.version}</Badge>
                  {config.config.adaptive && <Badge variant="outline">adaptive</Badge>}
                  <Badge
                    className={
                      config.status === "active"
                        ? "border-transparent bg-success/15 text-success"
                        : config.status === "draft"
                          ? "border-transparent bg-surface-active text-fg-secondary"
                          : "border-transparent bg-surface-active text-fg-muted"
                    }
                  >
                    {config.status}
                  </Badge>
                  <span className="text-caption text-fg-muted tabular-nums">
                    {formatNumber(config.attempts)} attempts ran on this version
                  </span>
                  {config.status !== "active" && config.status !== "retired" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => setPending(config)}
                    >
                      <CheckCircle2 aria-hidden />
                      Activate
                    </Button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[30rem] border-collapse text-body-sm">
                    <caption className="sr-only">Sections in {config.kind} version {config.version}</caption>
                    <thead>
                      <tr className="text-left">
                        <th scope="col" className="px-2 py-1 text-label text-fg-muted">Section</th>
                        <th scope="col" className="px-2 py-1 text-label text-fg-muted">Time limit</th>
                        <th scope="col" className="px-2 py-1 text-label text-fg-muted">Items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(config.config.sections ?? []).map((section, index) => (
                        <tr key={`${section.skill}-${index}`} className="border-t">
                          <td className="px-2 py-1.5 capitalize">{section.skill}</td>
                          <td className="px-2 py-1.5 tabular-nums">{Math.round(section.time_limit_seconds / 60)} min</td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {Object.entries(section.items ?? {})
                              .map(([band, count]) => `${count} ${band}`)
                              .join(" · ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AdaptiveModeCard configs={configs.data ?? []} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending ? `Activate ${pending.kind} v${pending.version}?` : ""}
        description="The version in use is retired and new assessments run on this one. Assessments already recorded keep the configuration they ran under."
        confirmLabel="Activate"
        loading={activate.isPending}
        onConfirm={() => {
          if (!pending) return;
          activate.mutate(pending.id, {
            onSuccess: () =>
              toast({ title: `${pending.kind} v${pending.version} is live`, variant: "success" }),
            onError: (error) =>
              toast({
                title: "Activation was refused",
                description: isApiError(error) ? error.message : undefined,
                variant: "error",
              }),
          });
          setPending(null);
        }}
      />
    </>
  );
}

function AttemptsSection({ days }: { days: number }) {
  const [status, setStatus] = useState<AttemptStatus | "all">("all");
  const [level, setLevel] = useState<CEFRLevel | "all">("all");
  const [page, setPage] = useState(1);

  const attempts = useAssessmentAttempts({ status, level, days, page });

  const columns: Column<AssessmentAttempt>[] = [
    {
      key: "learner",
      header: "Learner",
      width: "18rem",
      cell: (row) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/owner/learners/${row.user_id}`} className="truncate font-medium hover:underline">
            {row.email}
          </Link>
          <span className="truncate text-caption text-fg-muted capitalize">
            {row.kind} · started from {row.source}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge className={attemptStatusStyles[row.status]}>{attemptStatusLabels[row.status]}</Badge>,
    },
    { key: "start", header: "Start level", hideBelow: "lg", cell: (row) => <LevelBadge level={row.start_level} /> },
    {
      key: "result",
      header: "Result",
      cell: (row) =>
        row.overall_cefr ? (
          <span className="flex items-center gap-2">
            <LevelBadge level={row.overall_cefr} />
            <span className="text-fg-muted tabular-nums">{row.overall_score?.toFixed(0)}</span>
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: "confidence",
      header: "Confidence",
      hideBelow: "xl",
      cell: (row) => (
        <span className="tabular-nums">{row.confidence === null ? "—" : row.confidence.toFixed(2)}</span>
      ),
    },
    {
      key: "started",
      header: "Started",
      hideBelow: "md",
      cell: (row) => <span className="text-fg-muted tabular-nums">{formatDateTime(row.started_at)}</span>,
    },
  ];

  return (
    <>
      <FilterBar
        onReset={() => {
          setStatus("all");
          setLevel("all");
          setPage(1);
        }}
        resultLabel={attempts.isPending ? undefined : `${formatNumber(attempts.data?.total ?? 0)} attempts`}
      >
        <FilterSelect
          label="Status"
          value={status}
          options={[
            { value: "all" as const, label: "All statuses" },
            ...(Object.keys(attemptStatusLabels) as AttemptStatus[]).map((s) => ({ value: s, label: attemptStatusLabels[s] })),
          ]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Assessed level"
          value={level}
          options={[{ value: "all" as const, label: "Any result level" }, ...cefrLevels.map((l) => ({ value: l, label: l }))]}
          onChange={(value) => {
            setLevel(value);
            setPage(1);
          }}
        />
      </FilterBar>

      <SectionCard title="Attempts" description={`Last ${days} days`} bodyClassName="p-0">
        {attempts.isError ? (
          <div className="p-4">
            <LiveDataState error={attempts.error} onRetry={() => void attempts.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              caption="Assessment attempts"
              columns={columns}
              rows={attempts.data?.items ?? []}
              rowKey={(row) => row.id}
              isLoading={attempts.isPending}
              minWidth="58rem"
              empty={
                <p className="py-6 text-center text-body-sm text-fg-muted">
                  No assessment attempts in this period.
                </p>
              }
            />
            <Pagination
              page={attempts.data?.page ?? 1}
              totalPages={attempts.data?.total_pages ?? 1}
              total={attempts.data?.total ?? 0}
              pageSize={20}
              onPageChange={setPage}
              label="attempts"
            />
          </>
        )}
      </SectionCard>
    </>
  );
}

/**
 * Adaptive placement.
 *
 * The default test picks all four sections up front, around the level the learner said they
 * were — a guess by somebody who, by definition, does not know their own level. Adaptive
 * mode keeps reading fixed (nothing better is known yet) and chooses every later section
 * around what the completed sections actually measured, from the same item bank.
 *
 * Switching it on is a configuration change like any other: a new version is created and
 * activated, and assessments already in progress keep the version they started under.
 */
function AdaptiveModeCard({ configs }: { configs: AssessmentConfig[] }) {
  const create = useCreateAssessmentConfig();
  const activate = useActivateAssessmentConfig();
  const [confirming, setConfirming] = useState(false);

  const active = configs.find((c) => c.status === "active");
  const adaptive = active?.config.adaptive ?? false;
  const busy = create.isPending || activate.isPending;

  if (!active) return null;

  function apply() {
    if (!active) return;
    const next = { ...active.config, adaptive: !adaptive };
    create.mutate(
      { kind: active.kind, config: next },
      {
        onSuccess: (draft) =>
          activate.mutate(draft.id, {
            onSuccess: () =>
              toast({
                title: adaptive ? "Adaptive placement switched off" : "Adaptive placement switched on",
                description: `Running on ${active.kind} v${draft.version}.`,
                variant: "success",
              }),
            onError: (error) =>
              toast({
                title: "The new version was created but not activated",
                description: isApiError(error) ? error.message : undefined,
                variant: "error",
              }),
          }),
        onError: (error) =>
          toast({
            title: "The change could not be saved",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
      },
    );
    setConfirming(false);
  }

  return (
    <>
      <SectionCard
        className="mt-5"
        title="Adaptive placement"
        description={`Currently ${adaptive ? "on" : "off"} for ${active.kind} v${active.version}`}
        action={
          <Button size="sm" variant={adaptive ? "outline" : "default"} loading={busy} onClick={() => setConfirming(true)}>
            {adaptive ? "Switch off" : "Switch on"}
          </Button>
        }
      >
        <p className="text-body-sm text-fg-secondary">
          With it off, all four sections are chosen around the level the learner selected before starting. With it on,
          only reading is — every later section is chosen around what the completed sections measured, from the same
          item bank.
        </p>
        <p className="mt-2 text-caption text-fg-muted">
          A learner who says C1 and then reads at A2 is not handed a C1 listening section. Nothing about scoring
          changes: the bands, the combination rules and the level each item targets are the same either way.
        </p>
      </SectionCard>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={adaptive ? "Switch adaptive placement off?" : "Switch adaptive placement on?"}
        description={`A new version of ${active.kind} is created and activated. Tests already in progress keep the version they started under.`}
        confirmLabel={adaptive ? "Switch off" : "Switch on"}
        loading={busy}
        onConfirm={apply}
      />
    </>
  );
}
