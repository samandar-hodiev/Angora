"use client";

import {
  Activity,
  BadgeCheck,
  BarChart3,
  Crown,
  FileStack,
  Gauge,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { BarList, DonutChart, LearnerGrowthChart, planColors } from "../components/charts";
import { DataTable, type Column } from "../components/data-table";
import {
  CountPill,
  HealthDot,
  LearnerAvatar,
  LevelBadge,
  OwnerPageHeader,
  PlanBadge,
  SectionCard,
  SegmentedControl,
  StatCard,
  StatCardSkeleton,
} from "../components/primitives";
import {
  useActivityFeed,
  useActivitySummary,
  useContentStats,
  useConversionSummary,
  useDashboardMetrics,
  useHealthChecks,
  useLearnerGrowth,
  usePlanDistribution,
  useRecentConversions,
  useRecentLearners,
} from "../hooks";
import { formatCurrency, formatDate, formatNumber, formatRelative, planLabels, skillLabels } from "../lib/format";
import { MOCK_TODAY, rangeLabels } from "../lib/mock";
import type { Learner, PlanFilter, RangeKey } from "../types";

const NOW = `${MOCK_TODAY}T12:00:00Z`;

const metricIcons: Record<string, LucideIcon> = {
  learners_total: Users,
  learners_free: Users,
  learners_premium: BadgeCheck,
  learners_unlimited: Crown,
  active_learners: Activity,
  new_learners: UserPlus,
  conversion_rate: TrendingUp,
  mrr: Wallet,
  content_published: FileStack,
  ai_usage: Sparkles,
};

const planOptions: { value: PlanFilter; label: string; dotColor?: string }[] = [
  { value: "all", label: "All" },
  { value: "free", label: "Free", dotColor: planColors.free },
  { value: "premium", label: "Premium", dotColor: planColors.premium },
  { value: "unlimited", label: "Unlimited", dotColor: planColors.unlimited },
];

const rangeOptions: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
];

export function OwnerDashboardView() {
  // The year is the default: it is the only range where the growth of the platform is visible
  // at a glance, which is the question this page exists to answer.
  const [range, setRange] = useState<RangeKey>("12m");
  const [plan, setPlan] = useState<PlanFilter>("all");

  const metrics = useDashboardMetrics(plan);
  const growth = useLearnerGrowth(range);

  return (
    <>
      <OwnerPageHeader
        title="Dashboard"
        description="Platform overview and learner activity."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/owner/cms">
                <FileStack aria-hidden />
                Content
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/owner/cms/grammar/new">
                <Plus aria-hidden />
                New grammar topic
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SegmentedControl label="Filter learners by plan" value={plan} options={planOptions} onChange={setPlan} />
        <span className="text-caption text-fg-muted">
          {plan === "all" ? "All accounts" : `${planLabels[plan]} accounts only`}
        </span>
      </div>

      <section aria-label="Key metrics" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {metrics.isPending
          ? Array.from({ length: 10 }, (_, index) => <StatCardSkeleton key={index} />)
          : metrics.data?.metrics.map((metric) => (
              <StatCard
                key={metric.key}
                metric={metric}
                icon={metricIcons[metric.key]}
                emphasis={metric.key === "learners_total"}
              />
            ))}
      </section>

      <SectionCard
        title="Learner growth"
        description={`${plan === "all" ? "All plans" : planLabels[plan]} · ${rangeLabels[range]}`}
        className="mb-6"
        action={<SegmentedControl label="Date range" value={range} options={rangeOptions} onChange={setRange} size="sm" />}
      >
        {growth.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : growth.data ? (
          <>
            <ChartLegend plan={plan} />
            <LearnerGrowthChart points={growth.data.points} segment={plan} granularity={growth.data.granularity} />
          </>
        ) : (
          <EmptyState title="No growth data" description="Nothing has been recorded for this period yet." />
        )}
      </SectionCard>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <SubscriptionCard />
        <ActivityCard />
        <ConversionCard />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <RecentLearnersCard />
        <RecentConversionsCard />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ContentActivityCard />
        <HealthCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ActivityFeedCard />
        <QuickActionsCard />
      </div>
    </>
  );
}

function ChartLegend({ plan }: { plan: PlanFilter }) {
  const entries =
    plan === "all"
      ? [
          { label: "Free", color: planColors.free },
          { label: "Premium", color: planColors.premium },
          { label: "Unlimited", color: planColors.unlimited },
        ]
      : [{ label: `${planLabels[plan]} learners`, color: planColors[plan] }];

  return (
    <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-muted">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: entry.color }} />
          {entry.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-1.5 rounded-sm bg-fg-muted/35" />
        New registrations
      </li>
    </ul>
  );
}

function SubscriptionCard() {
  const { data, isPending } = usePlanDistribution();
  const total = data?.reduce((sum, slice) => sum + slice.learners, 0) ?? 0;

  return (
    <SectionCard title="Subscription distribution" description="Accounts by plan">
      {isPending || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <DonutChart
            label="Learners by plan"
            total={total}
            slices={data.map((slice) => ({
              key: slice.plan,
              label: planLabels[slice.plan],
              value: slice.learners,
              color: planColors[slice.plan],
            }))}
          />
          <p className="mt-4 border-t pt-3 text-caption text-fg-muted">
            Paid plans bring{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatCurrency(data.reduce((sum, slice) => sum + slice.mrr_cents, 0))}
            </span>{" "}
            in monthly recurring revenue.
          </p>
        </>
      )}
    </SectionCard>
  );
}

function ActivityCard() {
  const { data, isPending } = useActivitySummary();

  return (
    <SectionCard title="Learner activity" description="Accounts that opened a lesson">
      {isPending || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <BarList
          items={[
            {
              key: "today",
              label: "Active today",
              value: data.active_today,
              hint: `${((data.active_today / data.total) * 100).toFixed(1)}% of all learners`,
            },
            {
              key: "week",
              label: "Active this week",
              value: data.active_week,
              hint: `${((data.active_week / data.total) * 100).toFixed(1)}% of all learners`,
              color: "var(--info)",
            },
            {
              key: "month",
              label: "Active this month",
              value: data.active_month,
              hint: `${((data.active_month / data.total) * 100).toFixed(1)}% of all learners`,
              color: "var(--warning)",
            },
          ]}
        />
      )}
    </SectionCard>
  );
}

function ConversionCard() {
  const { data, isPending } = useConversionSummary();

  return (
    <SectionCard title="Premium conversions" description={data?.period_label ?? "This month"}>
      {isPending || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-0.5 rounded-lg border bg-surface-hover p-3">
              <p className="text-caption text-fg-muted">Free → Premium</p>
              <p className="text-h3 tabular-nums text-success">+{formatNumber(data.free_to_premium)}</p>
            </div>
            <div className="grid gap-0.5 rounded-lg border bg-surface-hover p-3">
              <p className="text-caption text-fg-muted">Premium → Unlimited</p>
              <p className="text-h3 tabular-nums text-success">+{formatNumber(data.premium_to_unlimited)}</p>
            </div>
          </div>
          <dl className="grid gap-1.5 border-t pt-3 text-body-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted">Conversion rate</dt>
              <dd className="tabular-nums">
                {data.conversion_rate}%{" "}
                <span className="text-caption text-success">
                  +{(data.conversion_rate - data.previous_conversion_rate).toFixed(1)} pts
                </span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted">Cancelled</dt>
              <dd className="tabular-nums">{data.churned}</dd>
            </div>
          </dl>
        </div>
      )}
    </SectionCard>
  );
}

function RecentLearnersCard() {
  const { data, isPending, isError, error, refetch } = useRecentLearners(6);

  const columns: Column<Learner>[] = [
    {
      key: "learner",
      header: "Learner",
      cell: (learner) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <LearnerAvatar name={learner.name} avatarUrl={learner.avatar_url} size="sm" />
          <div className="grid min-w-0">
            <Link href={`/owner/learners/${learner.id}`} className="truncate font-medium hover:underline">
              {learner.name}
            </Link>
            <span className="truncate text-caption text-fg-muted">{learner.email}</span>
          </div>
        </div>
      ),
    },
    { key: "plan", header: "Plan", cell: (learner) => <PlanBadge plan={learner.plan} /> },
    { key: "level", header: "Level", hideBelow: "sm", cell: (learner) => <LevelBadge level={learner.level} /> },
    {
      key: "joined",
      header: "Joined",
      hideBelow: "md",
      align: "right",
      cell: (learner) => <span className="text-fg-muted tabular-nums">{formatDate(learner.joined_at)}</span>,
    },
  ];

  return (
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
      <DataTable
        caption="The six most recent learner registrations"
        columns={columns}
        rows={data ?? []}
        rowKey={(learner) => learner.id}
        isLoading={isPending}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        skeletonRows={6}
        empty={<EmptyState title="No learners yet" description="New registrations will appear here as they arrive." />}
        className="min-w-0"
      />
    </SectionCard>
  );
}

function RecentConversionsCard() {
  const { data, isPending } = useRecentConversions(6);

  return (
    <SectionCard title="Recent premium conversions" description="Plan upgrades">
      {isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState title="No premium conversions in this period" description="Upgrades will be listed here." />
      ) : (
        <ul className="grid gap-2.5">
          {data.map((change) => (
            <li key={change.id} className="flex items-center gap-3">
              <LearnerAvatar name={change.learner_name} avatarUrl={change.avatar_url} size="sm" />
              <div className="grid min-w-0 flex-1">
                <Link href={`/owner/learners/${change.learner_id}`} className="truncate text-body-sm hover:underline">
                  {change.learner_name}
                </Link>
                <span className="flex items-center gap-1 text-caption text-fg-muted">
                  {planLabels[change.from_plan]} → {planLabels[change.to_plan]}
                  <span aria-hidden>·</span>
                  {formatRelative(change.changed_at, NOW)}
                </span>
              </div>
              <span className="shrink-0 text-body-sm tabular-nums">{formatCurrency(change.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ContentActivityCard() {
  const { data, isPending } = useContentStats();

  return (
    <SectionCard
      title="Content overview"
      description="Published items per skill"
      bodyClassName="p-0"
      action={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/owner/cms">Open CMS</Link>
        </Button>
      }
    >
      {isPending || !data ? (
        <div className="grid gap-2 p-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y">
          {data.map((stat) => (
            <li key={stat.skill} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              <Link
                href={stat.skill === "grammar" ? "/owner/cms/grammar" : `/owner/cms?type=${stat.skill}`}
                className="min-w-24 font-medium hover:underline"
              >
                {skillLabels[stat.skill]}
              </Link>
              <span className="text-body-sm text-fg-muted tabular-nums">{formatNumber(stat.total)} items</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <CountPill label="published" value={stat.published} tone="success" />
                {stat.review > 0 && <CountPill label="review" value={stat.review} tone="warning" />}
                {stat.draft > 0 && <CountPill label="draft" value={stat.draft} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function HealthCard() {
  const { data, isPending } = useHealthChecks();

  return (
    <SectionCard title="Platform status" description="Mock checks until monitoring is wired up">
      {isPending || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ul className="grid gap-3">
          {data.map((check) => (
            <li key={check.key} className="grid gap-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm font-medium">{check.label}</span>
                <HealthDot state={check.state} />
              </div>
              <p className="text-caption text-fg-muted">{check.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ActivityFeedCard() {
  const { data, isPending } = useActivityFeed(8);

  return (
    <SectionCard title="Recent activity" description="What changed on the platform">
      {isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState title="Nothing has happened yet" description="Publishing and plan changes will show up here." />
      ) : (
        <ol className="grid gap-3">
          {data.map((event) => (
            <li key={event.id} className="flex gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-surface-active text-fg-muted">
                <ActivityIcon kind={event.kind} />
              </span>
              <div className="grid min-w-0 gap-0.5">
                <p className="text-body-sm">{event.message}</p>
                <p className="text-caption text-fg-muted">
                  {event.detail && <>{event.detail} · </>}
                  {event.actor} · {formatRelative(event.created_at, NOW)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  const Icon =
    kind === "learner_registered"
      ? UserPlus
      : kind === "subscription_activated"
        ? BadgeCheck
        : kind === "paywall_changed"
          ? Gauge
          : kind === "settings_changed"
            ? Settings
            : kind === "wallpaper_enabled"
              ? Sparkles
              : FileStack;
  return <Icon className="size-3.5" aria-hidden />;
}

function QuickActionsCard() {
  const actions = [
    { href: "/owner/cms", label: "Add content", icon: Plus, hint: "Create or import a learner-facing item" },
    { href: "/owner/cms/grammar/new", label: "Create grammar topic", icon: Plus, hint: "Start from a draft or generate with AI" },
    { href: "/owner/paywall", label: "Manage paywall", icon: Gauge, hint: "Decide what free learners can reach" },
    { href: "/owner/learners", label: "View learners", icon: Users, hint: "Search, filter and inspect accounts" },
    { href: "/owner/settings", label: "Site settings", icon: Settings, hint: "Defaults, appearance and wallpapers" },
    { href: "/owner/analytics", label: "Full analytics", icon: BarChart3, hint: "Growth, plans and content in depth" },
  ];

  return (
    <SectionCard title="Quick actions" description="The things you do most">
      <ul className="grid gap-2 sm:grid-cols-2">
        {actions.map((action) => (
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
    </SectionCard>
  );
}
