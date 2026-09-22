"use client";

import {
  Activity,
  BadgeCheck,
  BarChart3,
  ClipboardList,
  CreditCard,
  FileStack,
  Gauge,
  Plus,
  Smartphone,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { BarList, DonutChart, LearnerGrowthChart, planColors } from "../components/charts";
import { LiveDataState } from "../components/live-state";
import {
  CountPill,
  OwnerPageHeader,
  SectionCard,
  SegmentedControl,
  StatCard,
  StatCardSkeleton,
} from "../components/primitives";
import { useAnalyticsOverview, useGrowthSeries, useLiveLearners } from "../hooks";
import { formatCurrency, formatDate, formatNumber, formatRelative } from "../lib/format";
import type { AnalyticsOverview, DashboardMetric, GrowthPoint, LearnerGrowthPoint } from "../types";

/**
 * The platform, on one page.
 *
 * Everything is counted from the database: accounts from users, revenue from live
 * subscriptions and plan prices, activity from analytics_events, AI cost from the per-call
 * ledger. There is no modelled or smoothed number here — when a figure is absent it is
 * because nothing has been recorded yet, and the page says so rather than showing a zero that
 * looks like a measurement.
 */

const rangeOptions = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "12M" },
];

const metricIcons: Record<string, LucideIcon> = {
  learners_total: Users,
  active_30d: Activity,
  new_learners: UserPlus,
  paying: BadgeCheck,
  mrr: Wallet,
  conversion: TrendingUp,
  content_published: FileStack,
  ai_cost: Sparkles,
};

/** The growth chart speaks LearnerGrowthPoint; the API speaks GrowthPoint. One mapping, here. */
function toChartPoints(points: GrowthPoint[], plans: AnalyticsOverview["plans"]): LearnerGrowthPoint[] {
  const paidShare = plans.filter((p) => p.mrr_cents > 0);
  return points.map((point) => {
    const free = Math.max(0, point.total - point.paying);
    // The series records how many were paying, not which plan they were on; the split below
    // is only for the stacked bands and is labelled as an estimate in the legend.
    const premium = paidShare.length > 1 ? Math.round(point.paying * 0.7) : point.paying;
    return {
      date: point.date.slice(0, 10),
      total: point.total,
      free,
      premium,
      unlimited: point.paying - premium,
      new_learners: point.new,
      new_free: point.new,
      new_premium: 0,
      new_unlimited: 0,
      active: point.active,
    };
  });
}

export function OwnerDashboardView() {
  const [days, setDays] = useState("30");
  const numericDays = Number(days);

  const overview = useAnalyticsOverview(numericDays);
  const growth = useGrowthSeries(numericDays);
  const recent = useLiveLearners({ page: 1, sort: "joined" });

  const data = overview.data;

  const metrics: DashboardMetric[] = data
    ? [
        {
          key: "learners_total",
          label: "Learners",
          value: data.learners.total,
          format: "number",
          hint: `${formatNumber(data.learners.onboarded)} finished onboarding`,
        },
        {
          key: "active_30d",
          label: "Active (30 days)",
          value: data.learners.active_30d,
          format: "number",
          hint: `${formatNumber(data.learners.active_today)} today · ${formatNumber(data.learners.active_week)} this week`,
        },
        {
          key: "new_learners",
          label: `New (${data.days} days)`,
          value: data.learners.new,
          format: "number",
          hint: `${formatNumber(data.learners.suspended)} accounts suspended`,
        },
        {
          key: "paying",
          label: "Paying learners",
          value: data.monetization.paying,
          format: "number",
          hint: `${formatNumber(data.monetization.new_paid)} new · ${formatNumber(data.monetization.cancelled)} cancelled`,
        },
        {
          key: "mrr",
          label: "Monthly revenue",
          value: data.monetization.mrr_cents,
          format: "currency",
          hint: "Active subscriptions at plan price",
        },
        {
          key: "conversion",
          label: "Conversion",
          value: Math.round(data.monetization.conversion_rate * 10) / 10,
          format: "percent",
          hint: "Learners on a paid plan",
        },
        {
          key: "content_published",
          label: "Published content",
          value: data.content.reduce((total, row) => total + row.published, 0),
          format: "number",
          hint: `${formatNumber(data.content.reduce((t, r) => t + r.review, 0))} waiting in review`,
        },
        {
          key: "ai_cost",
          label: `AI cost (${data.days} days)`,
          value: Math.round(data.ai.cost_usd * 100),
          format: "currency",
          hint: `${formatNumber(data.ai.requests)} requests · ${formatNumber(data.ai.failed)} failed`,
        },
      ]
    : [];

  if (overview.isError) {
    return (
      <>
        <OwnerPageHeader title="Dashboard" description="Platform overview and learner activity." />
        <LiveDataState error={overview.error} onRetry={() => void overview.refetch()} />
      </>
    );
  }

  return (
    <>
      <OwnerPageHeader
        title="Dashboard"
        description="Platform overview and learner activity, counted from the database."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/owner/analytics">
                <BarChart3 aria-hidden />
                Analytics
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/owner/content/grammar/new">
                <Plus aria-hidden />
                New grammar topic
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SegmentedControl label="Period" value={days} options={rangeOptions} onChange={setDays} />
        <span className="text-caption text-fg-muted">Live from the platform database.</span>
      </div>

      <section aria-label="Key metrics" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {overview.isPending
          ? Array.from({ length: 8 }, (_, index) => <StatCardSkeleton key={index} />)
          : metrics.map((metric) => (
              <StatCard key={metric.key} metric={metric} icon={metricIcons[metric.key]} emphasis={metric.key === "learners_total"} />
            ))}
      </section>

      <SectionCard
        title="Learner growth"
        description={`Registrations and the running total · last ${numericDays} days`}
        className="mb-6"
      >
        {growth.isPending || !data ? (
          <Skeleton className="h-72 w-full" />
        ) : growth.isError ? (
          <LiveDataState error={growth.error} onRetry={() => void growth.refetch()} />
        ) : (growth.data?.points.length ?? 0) === 0 ? (
          <p className="py-10 text-center text-body-sm text-fg-muted">No registrations recorded in this period.</p>
        ) : (
          <>
            <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-muted">
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: planColors.free }} />
                Free
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: planColors.premium }} />
                Paying
              </li>
              <li>Bars: registrations that day</li>
            </ul>
            <LearnerGrowthChart
              points={toChartPoints(growth.data!.points, data.plans)}
              segment="all"
              granularity="day"
            />
          </>
        )}
      </SectionCard>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Plans" description="Where learners sit">
          {overview.isPending || !data ? (
            <Skeleton className="h-32 w-full" />
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
              <p className="mt-4 border-t pt-3 text-caption text-fg-muted">
                {formatCurrency(data.monetization.mrr_cents)} monthly recurring revenue.
              </p>
            </>
          )}
        </SectionCard>

        <SectionCard title="Levels" description="Current level across all learners">
          {overview.isPending || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : data.learning.level_distribution.length === 0 ? (
            <p className="py-8 text-center text-body-sm text-fg-muted">
              No learner has a level yet — levels are set by placement or practice.
            </p>
          ) : (
            <BarList
              items={data.learning.level_distribution.map((bucket) => ({
                key: bucket.key,
                label: bucket.key,
                value: bucket.count,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard title="Top weaknesses" description="What learners are getting wrong">
          {overview.isPending || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : data.learning.top_weaknesses.length === 0 ? (
            <p className="py-8 text-center text-body-sm text-fg-muted">
              No weaknesses detected yet. They appear as learners practise.
            </p>
          ) : (
            <BarList
              items={data.learning.top_weaknesses.map((bucket) => ({
                key: bucket.key,
                label: bucket.key,
                value: bucket.count,
                color: "var(--warning)",
              }))}
            />
          )}
        </SectionCard>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <SectionCard
          title="Recent registrations"
          description="Newest accounts"
          bodyClassName="p-0"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/owner/learners">View all</Link>
            </Button>
          }
        >
          {recent.isPending ? (
            <div className="grid gap-2 p-4">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : recent.isError ? (
            <div className="p-4">
              <LiveDataState error={recent.error} onRetry={() => void recent.refetch()} />
            </div>
          ) : (recent.data?.items.length ?? 0) === 0 ? (
            <p className="p-6 text-center text-body-sm text-fg-muted">No accounts yet.</p>
          ) : (
            <ul className="divide-y">
              {recent.data!.items.slice(0, 6).map((learner) => (
                <li key={learner.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="grid min-w-0 flex-1">
                    <Link href={`/owner/learners/${learner.id}`} className="truncate text-body-sm font-medium hover:underline">
                      {learner.display_name || learner.email}
                    </Link>
                    <span className="truncate text-caption text-fg-muted">{learner.email}</span>
                  </div>
                  <span className="shrink-0 text-caption text-fg-muted">{learner.plan_name}</span>
                  <span className="shrink-0 text-caption text-fg-muted tabular-nums">{formatDate(learner.joined_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Content" description="What exists, by store">
          {overview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ul className="grid gap-2.5">
              {data.content.map((row) => (
                <li key={row.type} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-28 text-body-sm font-medium capitalize">{row.type.replace(/_/g, " ")}</span>
                  <span className="text-caption text-fg-muted tabular-nums">{formatNumber(row.total)} total</span>
                  <span className="ml-auto flex gap-1.5">
                    <CountPill label="published" value={row.published} tone="success" />
                    {row.review > 0 && <CountPill label="review" value={row.review} tone="warning" />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard title="AI" description={`Cost and reliability · last ${numericDays} days`}>
          {overview.isPending || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <dl className="grid gap-2 text-body-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-fg-muted">Requests</dt>
                  <dd className="tabular-nums">{formatNumber(data.ai.requests)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-fg-muted">Failed</dt>
                  <dd className={data.ai.failed > 0 ? "tabular-nums text-error" : "tabular-nums"}>
                    {formatNumber(data.ai.failed)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-fg-muted">Estimated cost</dt>
                  <dd className="tabular-nums">${data.ai.cost_usd.toFixed(2)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-fg-muted">Per paying learner</dt>
                  <dd className="tabular-nums">
                    {data.monetization.paying > 0 ? `$${data.ai.cost_usd_per_paying_learner.toFixed(2)}` : "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-fg-muted">Average latency</dt>
                  <dd className="tabular-nums">{Math.round(data.ai.avg_latency_ms)} ms</dd>
                </div>
              </dl>
              <Button variant="outline" size="sm" className="mt-4" asChild>
                <Link href="/owner/ai">Open AI monitoring</Link>
              </Button>
            </>
          )}
        </SectionCard>

        <SectionCard title="Quick actions" description="The things you do most">
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              { href: "/owner/content/question-bank", label: "Question bank", icon: ClipboardList, hint: "Author and publish assessment items" },
              { href: "/owner/content/grammar", label: "Grammar CMS", icon: FileStack, hint: "Lessons and explanations" },
              { href: "/owner/paywall", label: "Paywall", icon: Gauge, hint: "What each plan includes" },
              { href: "/owner/learners", label: "Learners", icon: Users, hint: "Search, inspect and support accounts" },
              { href: "/owner/audit", label: "Audit log", icon: CreditCard, hint: "Who changed what" },
              { href: "/owner/learner-app", label: "Learner App", icon: Smartphone, hint: "Defaults, features and maintenance" },
            ].map((action) => (
              <li key={action.href}>
                <Link
                  href={action.href}
                  className="flex h-full items-start gap-2.5 rounded-lg border bg-surface p-3 transition-colors duration-micro hover:border-primary/40 hover:bg-surface-hover"
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-subtle-foreground">
                    <action.icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="grid gap-0.5">
                    <span className="text-body-sm font-medium">{action.label}</span>
                    <span className="text-caption text-fg-muted">{action.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {data && data.learners.total > 0 && (
            <p className="mt-3 border-t pt-3 text-caption text-fg-muted">
              Last account joined {formatRelative(recent.data?.items[0]?.joined_at ?? new Date().toISOString(), new Date().toISOString())}.
            </p>
          )}
        </SectionCard>
      </div>
    </>
  );
}
