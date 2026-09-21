"use client";

import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { BarList, DonutChart, LearnerGrowthChart, planColors } from "../components/charts";
import { LiveDataState } from "../components/live-state";
import { FilterSelect, OwnerPageHeader, SectionCard, SegmentedControl, StatCard, StatCardSkeleton } from "../components/primitives";
import { useAnalyticsOverview, useGrowthSeries } from "../hooks";
import { formatCurrency, formatNumber } from "../lib/format";
import type { DashboardMetric, GrowthPoint, LearnerGrowthPoint } from "../types";

/**
 * Analytics, in the four sections the business actually asks about: where learners come from,
 * whether they come back, what they are learning, and what it earns and costs.
 *
 * Every figure is a count over a table. Where the platform has not recorded anything yet the
 * section says so — an empty chart is information, a fabricated one is not.
 */

const rangeOptions = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "12M" },
];

function toChartPoints(points: GrowthPoint[]): LearnerGrowthPoint[] {
  return points.map((point) => ({
    date: point.date.slice(0, 10),
    total: point.total,
    free: Math.max(0, point.total - point.paying),
    premium: point.paying,
    unlimited: 0,
    new_learners: point.new,
    new_free: point.new,
    new_premium: 0,
    new_unlimited: 0,
    active: point.active,
  }));
}

export function OwnerAnalyticsView() {
  const [days, setDays] = useState("90");
  const numericDays = Number(days);

  const overview = useAnalyticsOverview(numericDays);
  const growth = useGrowthSeries(numericDays);
  const data = overview.data;

  if (overview.isError) {
    return (
      <>
        <OwnerPageHeader title="Analytics" description="Acquisition, engagement, learning and monetization." />
        <LiveDataState error={overview.error} onRetry={() => void overview.refetch()} />
      </>
    );
  }

  const acquisition: DashboardMetric[] = data
    ? [
        { key: "new", label: "New accounts", value: data.learners.new, format: "number", hint: `In the last ${data.days} days` },
        {
          key: "onboarded",
          label: "Completed onboarding",
          value: data.learners.onboarded,
          format: "number",
          hint:
            data.learners.total > 0
              ? `${Math.round((data.learners.onboarded / data.learners.total) * 100)}% of all accounts`
              : "No accounts yet",
        },
        {
          key: "assessments",
          label: "Assessments completed",
          value: data.learning.assessments_completed,
          format: "number",
          hint: "Placement and skill tests finished",
        },
        {
          key: "suspended",
          label: "Suspended",
          value: data.learners.suspended,
          format: "number",
          hint: "Accounts blocked from signing in",
        },
      ]
    : [];

  const engagement: DashboardMetric[] = data
    ? [
        { key: "dau", label: "Active today", value: data.learners.active_today, format: "number", hint: "Signed in today" },
        { key: "wau", label: "Active this week", value: data.learners.active_week, format: "number", hint: "Last 7 days" },
        { key: "mau", label: "Active this month", value: data.learners.active_30d, format: "number", hint: "Last 30 days" },
        {
          key: "stickiness",
          label: "Stickiness",
          value: data.learners.active_30d > 0 ? Math.round((data.learners.active_today / data.learners.active_30d) * 1000) / 10 : 0,
          format: "percent",
          hint: "Daily active ÷ monthly active",
        },
      ]
    : [];

  const monetization: DashboardMetric[] = data
    ? [
        { key: "paying", label: "Paying learners", value: data.monetization.paying, format: "number", hint: "Live subscriptions" },
        { key: "mrr", label: "Monthly revenue", value: data.monetization.mrr_cents, format: "currency", hint: "Active subscriptions" },
        {
          key: "conversion",
          label: "Conversion",
          value: Math.round(data.monetization.conversion_rate * 10) / 10,
          format: "percent",
          hint: "Of all accounts",
        },
        {
          key: "cancelled",
          label: "Cancelled",
          value: data.monetization.cancelled,
          format: "number",
          hint: `In the last ${data.days} days`,
        },
      ]
    : [];

  return (
    <>
      <OwnerPageHeader
        title="Analytics"
        description="Acquisition, engagement, learning and monetization — counted from the database."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Analytics" }]}
        actions={<FilterSelect label="Period" value={days} options={rangeOptions.map((o) => ({ value: o.value, label: `Last ${o.label}` }))} onChange={setDays} />}
      />

      <div className="mb-5">
        <SegmentedControl label="Period" value={days} options={rangeOptions} onChange={setDays} />
      </div>

      <Section title="Acquisition" metrics={acquisition} pending={overview.isPending} />

      <SectionCard title="Growth" description={`Registrations and totals · last ${numericDays} days`} className="mb-6">
        {growth.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : growth.isError ? (
          <LiveDataState error={growth.error} onRetry={() => void growth.refetch()} />
        ) : (growth.data?.points.length ?? 0) === 0 ? (
          <p className="py-10 text-center text-body-sm text-fg-muted">Nothing recorded in this period.</p>
        ) : (
          <LearnerGrowthChart points={toChartPoints(growth.data!.points)} segment="all" granularity="day" />
        )}
      </SectionCard>

      <Section title="Engagement" metrics={engagement} pending={overview.isPending} />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Level distribution" description="Where learners currently sit">
          {overview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.learning.level_distribution.length === 0 ? (
            <Empty>No learner has a level recorded yet.</Empty>
          ) : (
            <BarList
              items={data.learning.level_distribution.map((b) => ({ key: b.key, label: b.key, value: b.count }))}
            />
          )}
        </SectionCard>

        <SectionCard title="Skill activity" description={`Practice in the last ${numericDays} days`}>
          {overview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.learning.skill_activity.length === 0 ? (
            <Empty>No practice recorded in this period.</Empty>
          ) : (
            <BarList
              items={data.learning.skill_activity.map((s) => ({
                key: s.skill,
                label: s.skill.charAt(0).toUpperCase() + s.skill.slice(1),
                value: s.sessions,
                hint: `${formatNumber(s.learners)} learners`,
                color: "var(--info)",
              }))}
            />
          )}
        </SectionCard>

        <SectionCard title="Weakness distribution" description="Most common across learners">
          {overview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.learning.top_weaknesses.length === 0 ? (
            <Empty>No weaknesses detected yet.</Empty>
          ) : (
            <BarList
              items={data.learning.top_weaknesses.map((b) => ({ key: b.key, label: b.key, value: b.count, color: "var(--warning)" }))}
            />
          )}
        </SectionCard>
      </div>

      <Section title="Monetization" metrics={monetization} pending={overview.isPending} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Plans" description="Learners and revenue per plan">
          {overview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <DonutChart
                label="Learners by plan"
                total={data.plans.reduce((sum, plan) => sum + plan.learners, 0)}
                slices={data.plans.map((plan, index) => ({
                  key: plan.plan_code,
                  label: plan.plan_name,
                  value: plan.learners,
                  color: [planColors.free, planColors.premium, planColors.unlimited][index % 3]!,
                }))}
              />
              <ul className="mt-4 grid gap-1.5 border-t pt-3 text-body-sm">
                {data.plans.map((plan) => (
                  <li key={plan.plan_code} className="flex items-baseline justify-between gap-3">
                    <span className="text-fg-muted">{plan.plan_name}</span>
                    <span className="tabular-nums">{formatCurrency(plan.mrr_cents)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard title="Content" description="Published across every store">
          {overview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <BarList
              items={data.content.map((row) => ({
                key: row.type,
                label: row.type.replace(/_/g, " "),
                value: row.published,
                display: `${formatNumber(row.published)} / ${formatNumber(row.total)}`,
                hint: `${row.review} in review · ${row.draft} draft`,
              }))}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard title="AI" description={`Requests, reliability and cost · last ${numericDays} days`}>
        {overview.isPending || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Requests", value: formatNumber(data.ai.requests) },
              { label: "Failed", value: formatNumber(data.ai.failed) },
              { label: "Cost", value: `$${data.ai.cost_usd.toFixed(2)}` },
              {
                label: "Per paying learner",
                value: data.monetization.paying > 0 ? `$${data.ai.cost_usd_per_paying_learner.toFixed(2)}` : "—",
              },
              { label: "Avg latency", value: `${Math.round(data.ai.avg_latency_ms)} ms` },
            ].map((stat) => (
              <div key={stat.label} className="grid gap-1 rounded-lg border bg-surface p-3">
                <span className="text-caption text-fg-muted">{stat.label}</span>
                <span className="text-h4 tabular-nums">{stat.value}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}

function Section({ title, metrics, pending }: { title: string; metrics: DashboardMetric[]; pending: boolean }) {
  return (
    <section aria-label={title} className="mb-6">
      <h2 className="mb-3 text-h4">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {pending
          ? Array.from({ length: 4 }, (_, index) => <StatCardSkeleton key={index} />)
          : metrics.map((metric) => <StatCard key={metric.key} metric={metric} />)}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-body-sm text-fg-muted">{children}</p>;
}
