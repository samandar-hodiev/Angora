"use client";

import { useState } from "react";

import { EmptyState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";

import { BarList, DonutChart, LearnerGrowthChart, planColors } from "../components/charts";
import { OwnerPageHeader, SectionCard, SegmentedControl, StatCard, StatCardSkeleton } from "../components/primitives";
import {
  useActivityFeed,
  useActivitySummary,
  useContentStats,
  useConversionSummary,
  useDashboardMetrics,
  useLearnerGrowth,
  usePlanDistribution,
} from "../hooks";
import { formatCurrency, formatNumber, formatRelative, planLabels } from "../lib/format";
import { MOCK_TODAY, rangeLabels } from "../lib/mock";
import type { PlanFilter, RangeKey } from "../types";

const NOW = `${MOCK_TODAY}T12:00:00Z`;

const planOptions: { value: PlanFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "free", label: "Free" },
  { value: "premium", label: "Premium" },
  { value: "unlimited", label: "Unlimited" },
];

const rangeOptions: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
];

export function OwnerAnalyticsView() {
  const [range, setRange] = useState<RangeKey>("6m");
  const [plan, setPlan] = useState<PlanFilter>("all");

  const growth = useLearnerGrowth(range);
  const metrics = useDashboardMetrics(plan);
  const distribution = usePlanDistribution();
  const activity = useActivitySummary();
  const conversions = useConversionSummary();
  const content = useContentStats();
  const feed = useActivityFeed(12);

  const headline = (metrics.data?.metrics ?? []).filter((metric) =>
    ["learners_total", "active_learners", "conversion_rate", "mrr"].includes(metric.key),
  );

  return (
    <>
      <OwnerPageHeader
        title="Analytics"
        description="Growth, plans, activity and content in one place."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Analytics" }]}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SegmentedControl label="Plan segment" value={plan} options={planOptions} onChange={setPlan} />
        <SegmentedControl label="Date range" value={range} options={rangeOptions} onChange={setRange} size="sm" />
      </div>

      <section aria-label="Headline metrics" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.isPending
          ? Array.from({ length: 4 }, (_, index) => <StatCardSkeleton key={index} />)
          : headline.map((metric) => <StatCard key={metric.key} metric={metric} />)}
      </section>

      <SectionCard
        title="Learner growth"
        description={`${plan === "all" ? "All plans" : planLabels[plan]} · ${rangeLabels[range]}`}
        className="mb-6"
      >
        {growth.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : growth.data && growth.data.points.length > 0 ? (
          <LearnerGrowthChart points={growth.data.points} segment={plan} granularity={growth.data.granularity} />
        ) : (
          <EmptyState title="No data for this period" description="Pick a longer range to see the trend." />
        )}
      </SectionCard>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Plans" description="Accounts and revenue per plan">
          {distribution.isPending || !distribution.data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <DonutChart
                label="Learners by plan"
                total={distribution.data.reduce((sum, slice) => sum + slice.learners, 0)}
                slices={distribution.data.map((slice) => ({
                  key: slice.plan,
                  label: planLabels[slice.plan],
                  value: slice.learners,
                  color: planColors[slice.plan],
                }))}
              />
              <ul className="mt-4 grid gap-1.5 border-t pt-3 text-body-sm">
                {distribution.data.map((slice) => (
                  <li key={slice.plan} className="flex items-baseline justify-between gap-3">
                    <span className="text-fg-muted">{planLabels[slice.plan]} revenue</span>
                    <span className="tabular-nums">{formatCurrency(slice.mrr_cents)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard title="Activity" description="Accounts opening lessons">
          {activity.isPending || !activity.data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <BarList
              items={[
                { key: "today", label: "Active today", value: activity.data.active_today },
                { key: "week", label: "Active this week", value: activity.data.active_week, color: "var(--info)" },
                { key: "month", label: "Active this month", value: activity.data.active_month, color: "var(--warning)" },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="Conversions" description={conversions.data?.period_label ?? ""}>
          {conversions.isPending || !conversions.data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <BarList
              items={[
                { key: "premium", label: "Free → Premium", value: conversions.data.free_to_premium },
                {
                  key: "unlimited",
                  label: "Premium → Unlimited",
                  value: conversions.data.premium_to_unlimited,
                  color: "var(--warning)",
                },
                { key: "churn", label: "Cancelled", value: conversions.data.churned, color: "var(--error)" },
              ]}
            />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard title="Content by skill" description="Published items">
          {content.isPending || !content.data ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <BarList
              items={content.data.map((stat) => ({
                key: stat.skill,
                label: stat.label,
                value: stat.published,
                display: `${formatNumber(stat.published)} / ${formatNumber(stat.total)}`,
                hint: `${stat.review} in review · ${stat.draft} draft`,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard title="Activity log" description="Recent platform events">
          {feed.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ol className="grid gap-3">
              {feed.data?.map((event) => (
                <li key={event.id} className="grid gap-0.5 border-b pb-2.5 last:border-b-0 last:pb-0">
                  <p className="text-body-sm">{event.message}</p>
                  <p className="text-caption text-fg-muted">
                    {event.actor} · {formatRelative(event.created_at, NOW)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>
    </>
  );
}
