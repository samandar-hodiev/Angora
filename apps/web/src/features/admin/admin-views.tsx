"use client";

import type { HealthReport } from "@engora/types";
import { useQuery } from "@tanstack/react-query";
import { Activity, CircleDollarSign, Percent, Users } from "lucide-react";
import { useState } from "react";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { BarChart, Meter, Stat } from "@/components/ui/data-display";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/features/learner/components/pagination";
import { useLevels, useSkills } from "@/features/learning/hooks";
import { apiClient } from "@/lib/api";
import { humanize, timeAgo } from "@/lib/learning-format";
import { cn } from "@/lib/utils";

import { useAdminContent, useAdminOverview, useAdminUsers, useAIUsage } from "./api";

const usd = (v: number, digits = 2) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(v);
const num = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v));

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-surface">
      <table className="w-full min-w-[40rem] text-left text-body-sm">
        <thead className="border-b bg-surface-hover text-label text-fg-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

const td = "px-4 py-2.5 align-middle";

// ---- Overview ------------------------------------------------------------------------------

export function AdminOverviewView() {
  const overview = useAdminOverview();
  const usage = useAIUsage(30);

  if (overview.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  const paying = o.plans.filter((p) => !p.is_default).reduce((s, p) => s + p.users, 0);
  const conversion = o.users.total ? (paying / o.users.total) * 100 : 0;

  return (
    <>
      <PageHeader title="Overview" description="Business and platform health at a glance." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Users" value={num(o.users.total)} icon={Users} hint={`+${o.users.new_7d} this week`} />
        <Stat label="Active users" value={num(o.users.active_30d)} icon={Activity} hint="Last 30 days" />
        <Stat label="MRR" value={usd(o.mrr_cents / 100, 0)} icon={CircleDollarSign} />
        <Stat label="AI cost" value={usd(o.ai.cost_usd_30d)} icon={CircleDollarSign} hint="Last 30 days" />
        <Stat label="Conversion" value={`${conversion.toFixed(1)}%`} icon={Percent} hint="Paying / all users" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="ai-daily" className="rounded-xl border bg-surface p-5">
          <SectionTitle id="ai-daily" title="AI cost per day" />
          {usage.data && usage.data.daily.length > 0 ? (
            <BarChart
              label="Daily AI cost for the last 30 days"
              data={usage.data.daily.map((d) => ({ label: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }), value: d.cost_usd }))}
              formatValue={(v) => usd(v)}
            />
          ) : (
            <p className="text-body-sm text-fg-muted">No AI usage recorded yet.</p>
          )}
        </section>
        <section aria-labelledby="plans-dist" className="grid content-start gap-4 rounded-xl border bg-surface p-5">
          <SectionTitle id="plans-dist" title="Users by plan" />
          {o.plans.map((p) => (
            <Meter key={p.plan_code} label={p.plan_name} value={p.users} max={Math.max(o.users.total, 1)} display={num(p.users)} />
          ))}
          <SectionTitle title="Content" />
          <div className="flex flex-wrap gap-2">
            {o.content.length === 0 && <span className="text-body-sm text-fg-muted">No content</span>}
            {o.content.map((c) => (
              <Badge key={c.status} variant="secondary">
                {humanize(c.status)} · {c.count}
              </Badge>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

// ---- Users ------------------------------------------------------------------------------------

export function AdminUsersView() {
  const [page, setPage] = useState(1);
  const users = useAdminUsers(page);
  return (
    <>
      <PageHeader title="Users" />
      {users.isPending ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <>
          <Table head={["Email", "Role", "Status", "Last login", "Joined"]}>
            {users.data.items.map((u) => (
              <tr key={u.id}>
                <td className={cn(td, "font-medium")}>{u.email}</td>
                <td className={td}>
                  <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role}</Badge>
                </td>
                <td className={td}>
                  <Badge variant={u.status === "active" ? "success" : "destructive"}>{u.status}</Badge>
                </td>
                <td className={cn(td, "text-fg-muted")}>{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</td>
                <td className={cn(td, "text-fg-muted")}>{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageSize={25} total={users.data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

// ---- Subscriptions / revenue ----------------------------------------------------------------------

export function AdminSubscriptionsView() {
  const overview = useAdminOverview();
  return (
    <>
      <PageHeader title="Subscriptions" description="Live subscriptions by plan. Users without one are on the default plan." />
      {overview.isPending ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : overview.isError ? (
        <ErrorState error={overview.error} />
      ) : (
        <Table head={["Plan", "Code", "Users", "Share"]}>
          {overview.data.plans.map((p) => (
            <tr key={p.plan_code}>
              <td className={cn(td, "font-medium")}>
                {p.plan_name} {p.is_default && <Badge variant="outline">default</Badge>}
              </td>
              <td className={cn(td, "font-mono text-fg-muted")}>{p.plan_code}</td>
              <td className={cn(td, "tabular-nums")}>{num(p.users)}</td>
              <td className={cn(td, "tabular-nums")}>{overview.data.users.total ? ((p.users / overview.data.users.total) * 100).toFixed(1) : "0.0"}%</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export function AdminPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={`${title} is coming`} description={description} />
    </>
  );
}

// ---- Content --------------------------------------------------------------------------------------

const contentTypes = ["speaking_topic", "writing_task", "reading_passage", "listening_exercise", "grammar_exercise", "exam_question", "mock_exam"];
const statuses = ["draft", "review", "published", "archived"];
const statusTone = { draft: "secondary", review: "warning", published: "success", archived: "outline" } as const;

export function AdminContentView() {
  const skills = useSkills();
  const levels = useLevels();
  const [filters, setFilters] = useState({ type: "", skill: "", level: "", status: "", page: 1 });
  const content = useAdminContent(filters);
  const set = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters((f) => ({ ...f, [key]: e.target.value, page: 1 }));

  const select = (id: keyof typeof filters, label: string, options: { value: string; label: string }[]) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`f-${id}`}>{label}</Label>
      <NativeSelect id={`f-${id}`} value={String(filters[id])} onChange={set(id)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <>
      <PageHeader title="Content" description="Every content item in every status. Editing arrives with the CMS." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select("type", "Type", contentTypes.map((t) => ({ value: t, label: humanize(t) })))}
        {select("skill", "Skill", (skills.data ?? []).map((s) => ({ value: s.code, label: s.name })))}
        {select("level", "Level", (levels.data ?? []).map((l) => ({ value: l.code, label: l.code })))}
        {select("status", "Status", statuses.map((s) => ({ value: s, label: humanize(s) })))}
      </div>
      {content.isPending ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : content.isError ? (
        <ErrorState error={content.error} onRetry={() => void content.refetch()} />
      ) : content.data.items.length === 0 ? (
        <EmptyState title="No content matches these filters" />
      ) : (
        <>
          <Table head={["Title", "Type", "Skill", "Level", "Difficulty", "Status", "Updated"]}>
            {content.data.items.map((c) => (
              <tr key={c.id}>
                <td className={cn(td, "font-medium")}>
                  {c.title} {c.exam && <Badge variant="outline">{c.exam.toUpperCase()}</Badge>}
                </td>
                <td className={cn(td, "text-fg-muted")}>{humanize(c.type)}</td>
                <td className={cn(td, "capitalize")}>{c.skill ?? "—"}</td>
                <td className={td}>{c.level ?? "—"}</td>
                <td className={cn(td, "tabular-nums")}>{c.difficulty}/10</td>
                <td className={td}>
                  <Badge variant={statusTone[c.status]}>{c.status}</Badge>
                </td>
                <td className={cn(td, "text-fg-muted")}>{timeAgo(c.updated_at)}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={filters.page} pageSize={25} total={content.data.meta.total} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}
    </>
  );
}

// ---- AI usage & costs -------------------------------------------------------------------------------

function DaysPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div role="group" aria-label="Period" className="inline-flex rounded-lg border bg-surface p-1">
      {[7, 30, 90].map((d) => (
        <button
          key={d}
          aria-pressed={days === d}
          onClick={() => onChange(d)}
          className={cn("rounded-md px-3 py-1 text-label", days === d ? "bg-surface-active" : "text-fg-muted hover:text-foreground")}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

export function AdminAIUsageView() {
  const [days, setDays] = useState(30);
  const usage = useAIUsage(days);
  return (
    <>
      <PageHeader title="AI Usage" description="Requests, tokens, audio, latency and errors by task and model." actions={<DaysPicker days={days} onChange={setDays} />} />
      {usage.isPending ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : usage.isError ? (
        <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Requests" value={num(usage.data.totals.requests)} />
            <Stat label="Failed" value={num(usage.data.totals.failed)} hint={usage.data.totals.requests ? `${((usage.data.totals.failed / usage.data.totals.requests) * 100).toFixed(1)}% error rate` : undefined} />
            <Stat label="Tokens" value={num(usage.data.totals.input_tokens + usage.data.totals.output_tokens)} hint={`${num(usage.data.totals.input_tokens)} in · ${num(usage.data.totals.output_tokens)} out`} />
            <Stat label="Audio" value={`${num(usage.data.totals.audio_seconds / 60)} min`} />
          </div>
          <SectionTitle title="By model" />
          <Table head={["Provider", "Model", "Requests", "Errors", "Tokens", "Audio", "Avg latency", "Cost"]}>
            {usage.data.by_model.map((r) => (
              <tr key={r.key}>
                <td className={td}>{r.provider}</td>
                <td className={cn(td, "font-mono")}>{r.model}</td>
                <td className={cn(td, "tabular-nums")}>{num(r.requests)}</td>
                <td className={cn(td, "tabular-nums", r.failed > 0 && "text-error")}>{num(r.failed)}</td>
                <td className={cn(td, "tabular-nums")}>{num(r.input_tokens + r.output_tokens)}</td>
                <td className={cn(td, "tabular-nums")}>{num(r.audio_seconds / 60)} min</td>
                <td className={cn(td, "tabular-nums")}>{r.avg_latency_ms ? `${num(r.avg_latency_ms)} ms` : "—"}</td>
                <td className={cn(td, "tabular-nums")}>{usd(r.cost_usd)}</td>
              </tr>
            ))}
          </Table>
          <div className="mt-8">
            <SectionTitle title="By task" />
            <Table head={["Task", "Requests", "Errors", "Tokens", "Audio", "Cost"]}>
              {usage.data.by_task.map((r) => (
                <tr key={r.key}>
                  <td className={cn(td, "font-medium")}>{humanize(r.key)}</td>
                  <td className={cn(td, "tabular-nums")}>{num(r.requests)}</td>
                  <td className={cn(td, "tabular-nums")}>{num(r.failed)}</td>
                  <td className={cn(td, "tabular-nums")}>{num(r.input_tokens + r.output_tokens)}</td>
                  <td className={cn(td, "tabular-nums")}>{num(r.audio_seconds / 60)} min</td>
                  <td className={cn(td, "tabular-nums")}>{usd(r.cost_usd)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </>
  );
}

export function AdminAICostsView() {
  const [days, setDays] = useState(30);
  const usage = useAIUsage(days);
  return (
    <>
      <PageHeader title="AI Costs" description="Estimated provider cost. Often the largest operating expense — watch it closely." actions={<DaysPicker days={days} onChange={setDays} />} />
      {usage.isPending ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : usage.isError ? (
        <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <section className="grid content-start gap-4 rounded-xl border bg-surface p-5">
            <div>
              <p className="text-label text-fg-muted">Total · last {days} days</p>
              <p className="text-display tabular-nums">{usd(usage.data.totals.cost_usd)}</p>
            </div>
            {usage.data.by_task.map((r) => (
              <Meter key={r.key} label={humanize(r.key)} value={r.cost_usd} max={Math.max(usage.data.totals.cost_usd, 0.0001)} display={usd(r.cost_usd)} />
            ))}
            {usage.data.by_task.length === 0 && <p className="text-body-sm text-fg-muted">No AI usage recorded yet.</p>}
          </section>
          <section className="grid content-start gap-6 rounded-xl border bg-surface p-5">
            <SectionTitle title="Daily cost" />
            {usage.data.daily.length > 0 ? (
              <BarChart
                label={`Daily AI cost for the last ${days} days`}
                data={usage.data.daily.map((d) => ({ label: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }), value: d.cost_usd }))}
                formatValue={(v) => usd(v)}
                height={180}
              />
            ) : (
              <p className="text-body-sm text-fg-muted">No data for this period.</p>
            )}
            <SectionTitle title="Cost by model" />
            {usage.data.by_model.map((r) => (
              <Meter key={r.key} label={r.key} value={r.cost_usd} max={Math.max(usage.data.totals.cost_usd, 0.0001)} display={usd(r.cost_usd)} />
            ))}
          </section>
        </div>
      )}
    </>
  );
}

// ---- System ------------------------------------------------------------------------------------------

export function AdminSystemView() {
  const health = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => apiClient.get<HealthReport>("/health", { auth: false }),
    refetchInterval: 15_000,
  });
  const metrics = useQuery({
    queryKey: ["admin", "metrics"],
    queryFn: () => apiClient.get<Record<string, unknown>>("/admin/system/metrics"),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader title="System" description="API dependencies and request metrics, refreshed every 15 seconds." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-surface p-5">
          <SectionTitle title="Health" action={health.data && <Badge variant={health.data.status === "ok" ? "success" : "destructive"}>{health.data.status}</Badge>} />
          {health.isPending ? (
            <Skeleton className="h-24" />
          ) : health.isError ? (
            <ErrorState title="API unreachable or degraded" error={health.error} />
          ) : (
            <ul className="divide-y">
              {Object.entries(health.data.checks).map(([name, check]) => (
                <li key={name} className="flex items-center justify-between py-2.5 text-body-sm">
                  <span className="capitalize">{name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-fg-muted tabular-nums">{check.latency_ms} ms</span>
                    <Badge variant={check.status === "up" ? "success" : "destructive"}>{check.status}</Badge>
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between py-2.5 text-body-sm">
                <span>Version</span>
                <span className="font-mono text-fg-muted">{health.data.version}</span>
              </li>
            </ul>
          )}
        </section>
        <section className="rounded-xl border bg-surface p-5">
          <SectionTitle title="Metrics" />
          {metrics.isPending ? (
            <Skeleton className="h-40" />
          ) : metrics.isError ? (
            <ErrorState error={metrics.error} />
          ) : (
            <pre className="overflow-x-auto rounded-lg bg-surface-hover p-4 font-mono text-caption">{JSON.stringify(metrics.data, null, 2)}</pre>
          )}
        </section>
      </div>
    </>
  );
}
