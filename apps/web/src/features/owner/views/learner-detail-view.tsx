"use client";

import { ArrowLeft, Ban, Flame, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import {
  ConfirmDialog,
  KeyValue,
  LearnerAvatar,
  LevelBadge,
  OwnerPageHeader,
  SectionCard,
} from "../components/primitives";
import { useLiveLearner, useSetLearnerStatus } from "../hooks";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatRelative } from "../lib/format";
import type { LevelKind, LiveLearnerDetail } from "../types";

const activeTab = "data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border";
const now = () => new Date().toISOString();

/**
 * One learner, as the platform actually knows them.
 *
 * The three level statements are shown side by side rather than reconciled into one number:
 * what the learner said about themselves, what a placement measured, and the platform's
 * current estimate are different claims, and the gap between them is the useful part.
 */
const levelLabels: Record<LevelKind, string> = {
  self_reported: "Self-reported",
  placement_start: "Placement start",
  assessed: "Assessed",
  estimated: "Current estimate",
};

export function LearnerDetailView({ id }: { id: string }) {
  const learner = useLiveLearner(id);
  const setStatus = useSetLearnerStatus();
  const [suspending, setSuspending] = useState(false);

  if (learner.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (learner.isError || !learner.data) {
    return (
      <>
        <OwnerPageHeader
          title="Learner"
          breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Learners", href: "/owner/learners" }]}
        />
        <LiveDataState error={learner.error} onRetry={() => void learner.refetch()} />
      </>
    );
  }

  const d: LiveLearnerDetail = learner.data;
  const name = d.display_name || d.email;

  return (
    <>
      <OwnerPageHeader
        title={name}
        description={d.email}
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Learners", href: "/owner/learners" },
          { label: name },
        ]}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/owner/learners">
                <ArrowLeft aria-hidden />
                All learners
              </Link>
            </Button>
            {d.status === "suspended" ? (
              <Button
                size="sm"
                loading={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate(
                    { id: d.id, status: "active" },
                    { onSuccess: () => toast({ title: `${name} reactivated`, variant: "success" }) },
                  )
                }
              >
                <RotateCcw aria-hidden />
                Reactivate
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSuspending(true)}>
                <Ban aria-hidden />
                Suspend
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border bg-surface p-4">
        <LearnerAvatar name={name} avatarUrl={d.avatar_url} />
        <div className="grid min-w-0 gap-0.5">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-caption text-fg-muted">
            {d.learning_goals.length > 0 ? d.learning_goals.join(" · ") : "No goals set"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge variant="outline">{d.plan_name}</Badge>
          {d.current_level && <LevelBadge level={d.current_level} />}
          <Badge
            className={cn(
              d.status === "active" && "border-transparent bg-success/15 text-success",
              d.status === "suspended" && "border-transparent bg-error/15 text-error",
              d.status === "deleted" && "border-transparent bg-surface-active text-fg-muted",
            )}
          >
            {d.status}
          </Badge>
          {d.role !== "USER" && <Badge variant="secondary">{d.role}</Badge>}
          {d.streak_days > 0 && (
            <span className="inline-flex items-center gap-1 text-caption text-warning-foreground">
              <Flame className="size-3.5" aria-hidden />
              {d.streak_days} day streak
            </span>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" className={activeTab}>Overview</TabsTrigger>
          <TabsTrigger value="learning" className={activeTab}>Learning</TabsTrigger>
          <TabsTrigger value="assessments" className={activeTab}>Assessments</TabsTrigger>
          <TabsTrigger value="subscription" className={activeTab}>Subscription</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Profile" description="What the learner told us">
              <dl className="grid">
                <KeyValue label="Email">{d.email}</KeyValue>
                <KeyValue label="Phone">{d.phone ?? "Not provided"}</KeyValue>
                <KeyValue label="Native language">{d.native_language ?? "Not provided"}</KeyValue>
                <KeyValue label="Timezone">{d.timezone}</KeyValue>
                <KeyValue label="Daily goal">{d.daily_goal_minutes} minutes</KeyValue>
                <KeyValue label="Target level">
                  {d.target_level ? <LevelBadge level={d.target_level} /> : "Not set"}
                </KeyValue>
              </dl>
            </SectionCard>

            <SectionCard title="Account" description="Status and history">
              <dl className="grid">
                <KeyValue label="Joined">{formatDate(d.joined_at)}</KeyValue>
                <KeyValue label="Last seen">
                  {d.last_active_at ? formatRelative(d.last_active_at, now()) : "Never signed in"}
                </KeyValue>
                <KeyValue label="Onboarding">{d.onboarded ? "Complete" : "Unfinished"}</KeyValue>
                <KeyValue label="Role">{d.role}</KeyValue>
                <KeyValue label="AI cost (30 days)">${d.ai_cost_usd_30d.toFixed(2)}</KeyValue>
                <KeyValue label="AI requests (30 days)">{formatNumber(d.ai_requests_30d)}</KeyValue>
              </dl>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="learning">
          <div className="grid gap-4">
            <SectionCard
              title="Level"
              description="Each statement is kept apart — what they said, what was measured, what we estimate"
            >
              {d.levels.length === 0 ? (
                <p className="py-4 text-body-sm text-fg-muted">
                  No level statement yet. One is written when the learner picks a level or finishes a placement test.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {d.levels.map((level) => (
                    <li key={level.kind} className="grid gap-1 rounded-lg border bg-surface p-3">
                      <span className="text-caption text-fg-muted">{levelLabels[level.kind] ?? level.kind}</span>
                      <LevelBadge level={level.cefr} />
                      <span className="text-caption text-fg-muted">
                        {level.source_type}
                        {level.confidence !== null && ` · confidence ${level.confidence.toFixed(2)}`}
                      </span>
                      <span className="text-caption text-fg-disabled">{formatDate(level.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <SectionCard title="Skill progress" description="From skill_progress">
                {d.skills.length === 0 ? (
                  <p className="py-4 text-body-sm text-fg-muted">No practice recorded yet.</p>
                ) : (
                  <ul className="grid gap-4">
                    {d.skills.map((skill) => (
                      <li key={skill.skill}>
                        <Meter
                          label={
                            <span className="flex items-center gap-2">
                              {skill.skill_name}
                              {skill.estimated_level && <span className="text-caption text-fg-muted">{skill.estimated_level}</span>}
                            </span>
                          }
                          value={skill.score}
                          display={`${Math.round(skill.score)}%`}
                          tone={skill.score > 70 ? "success" : skill.score < 35 ? "warning" : "primary"}
                        />
                        <p className="mt-1 text-caption text-fg-muted">
                          {formatNumber(skill.sessions)} sessions ·{" "}
                          {skill.last_practiced_at ? `last ${formatRelative(skill.last_practiced_at, now())}` : "never practised"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard title="Weaknesses" description="Detected from practice and AI analysis">
                {d.weaknesses.length === 0 ? (
                  <p className="py-4 text-body-sm text-fg-muted">Nothing detected yet.</p>
                ) : (
                  <ul className="grid gap-3">
                    {d.weaknesses.map((weakness) => (
                      <li key={weakness.category} className="grid gap-1 rounded-lg border bg-surface p-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-body-sm font-medium">{weakness.category}</span>
                          <span className="shrink-0 text-caption tabular-nums text-warning-foreground">
                            severity {Math.round(weakness.severity)}
                          </span>
                        </div>
                        <p className="text-caption text-fg-muted">
                          {weakness.skill ?? "general"} · {weakness.evidence_count} observations · {weakness.status} · last seen{" "}
                          {formatRelative(weakness.last_detected_at, now())}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="assessments">
          <SectionCard title="Assessments" description="Every attempt on this account">
            {d.assessments.length === 0 ? (
              <p className="py-4 text-body-sm text-fg-muted">This learner has not taken an assessment.</p>
            ) : (
              <ul className="divide-y">
                {d.assessments.map((assessment) => (
                  <li key={assessment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span className="min-w-24 font-medium capitalize">{assessment.kind}</span>
                    <Badge variant="outline">{assessment.status}</Badge>
                    {assessment.overall_cefr ? (
                      <span className="flex items-center gap-2">
                        <LevelBadge level={assessment.overall_cefr} />
                        <span className="text-caption text-fg-muted tabular-nums">
                          {assessment.overall_score?.toFixed(0)}/100
                        </span>
                      </span>
                    ) : (
                      <span className="text-caption text-fg-muted">No result</span>
                    )}
                    <span className="ml-auto text-caption text-fg-muted tabular-nums">
                      {formatDateTime(assessment.started_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="subscription">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Subscription" description="Plan and billing">
              {d.subscription ? (
                <dl className="grid">
                  <KeyValue label="Plan">{d.subscription.plan_name}</KeyValue>
                  <KeyValue label="Status">{d.subscription.status}</KeyValue>
                  <KeyValue label="Price">
                    {d.subscription.price_cents > 0 ? formatCurrency(d.subscription.price_cents) : "Free"}
                  </KeyValue>
                  <KeyValue label="Provider">{d.subscription.provider}</KeyValue>
                  <KeyValue label="Period started">
                    {d.subscription.started_at ? formatDate(d.subscription.started_at) : "—"}
                  </KeyValue>
                  <KeyValue label="Renews">
                    {d.subscription.renews_at ? formatDate(d.subscription.renews_at) : "—"}
                  </KeyValue>
                  <KeyValue label="Cancels at period end">{d.subscription.cancel_at_period_end ? "Yes" : "No"}</KeyValue>
                </dl>
              ) : (
                <p className="py-4 text-body-sm text-fg-muted">
                  No subscription — this learner is on the default {d.plan_name} plan.
                </p>
              )}
            </SectionCard>

            <SectionCard title="Entitlement usage" description="What they have spent this period and last">
              {d.usage.length === 0 ? (
                <p className="py-4 text-body-sm text-fg-muted">Nothing metered has been used yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {d.usage.map((usage) => (
                    <li key={`${usage.entitlement}-${usage.period_start}`} className="flex items-baseline justify-between gap-3 text-body-sm">
                      <code className="truncate font-mono text-caption">{usage.entitlement}</code>
                      <span className="shrink-0 tabular-nums">
                        {formatNumber(usage.used)}
                        <span className="ml-1.5 text-fg-muted">from {formatDate(usage.period_start)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={suspending}
        onOpenChange={setSuspending}
        title={`Suspend ${name}?`}
        description="Their sessions are revoked immediately and they cannot sign in until the account is reactivated."
        confirmLabel="Suspend"
        destructive
        loading={setStatus.isPending}
        onConfirm={() => {
          setStatus.mutate(
            { id: d.id, status: "suspended" },
            {
              onSuccess: () => toast({ title: `${name} suspended`, variant: "success" }),
              onError: (error) =>
                toast({
                  title: "That change was refused",
                  description: isApiError(error) ? error.message : undefined,
                  variant: "error",
                }),
            },
          );
          setSuspending(false);
        }}
      />
    </>
  );
}
