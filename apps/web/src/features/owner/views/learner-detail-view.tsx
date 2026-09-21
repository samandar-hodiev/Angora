"use client";

import { ArrowLeft, Ban, CreditCard, Flame, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";

import {
  ConfirmDialog,
  KeyValue,
  LearnerAvatar,
  LearnerStatusBadge,
  LevelBadge,
  OwnerPageHeader,
  PlanBadge,
  SectionCard,
} from "../components/primitives";
import { useLearner, useUpdateLearnerStatus } from "../hooks";
import { formatCurrency, formatDate, formatNumber, formatRelative, planLabels, skillLabels } from "../lib/format";
import { MOCK_TODAY } from "../lib/mock";

const NOW = `${MOCK_TODAY}T12:00:00Z`;

export function LearnerDetailView({ id }: { id: string }) {
  const learner = useLearner(id);
  const updateStatus = useUpdateLearnerStatus();
  const [suspending, setSuspending] = useState(false);

  if (learner.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
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
        <ErrorState
          error={learner.error}
          title="This learner could not be opened"
          description="The account may have been removed."
          onRetry={() => void learner.refetch()}
        />
      </>
    );
  }

  const detail = learner.data;

  return (
    <>
      <OwnerPageHeader
        title={detail.name}
        description={detail.email}
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Learners", href: "/owner/learners" },
          { label: detail.name },
        ]}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/owner/learners">
                <ArrowLeft aria-hidden />
                All learners
              </Link>
            </Button>
            {detail.status === "suspended" ? (
              <Button
                size="sm"
                loading={updateStatus.isPending}
                onClick={() =>
                  updateStatus.mutate(
                    { id: detail.id, status: "active" },
                    { onSuccess: () => toast({ title: `${detail.name} reactivated`, variant: "success" }) },
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
        <LearnerAvatar name={detail.name} avatarUrl={detail.avatar_url} />
        <div className="grid min-w-0 gap-0.5">
          <p className="truncate font-medium">{detail.name}</p>
          <p className="truncate text-caption text-fg-muted">{detail.goal}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PlanBadge plan={detail.plan} />
          <LevelBadge level={detail.level} />
          <LearnerStatusBadge status={detail.status} />
          {detail.streak_days > 0 && (
            <span className="inline-flex items-center gap-1 text-caption text-warning-foreground">
              <Flame className="size-3.5" aria-hidden />
              {detail.streak_days} day streak
            </span>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" className="data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border">Overview</TabsTrigger>
          <TabsTrigger value="learning" className="data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border">Learning</TabsTrigger>
          <TabsTrigger value="activity" className="data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border">Activity</TabsTrigger>
          <TabsTrigger value="subscription" className="data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border">Subscription</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Profile" description="What the learner told us">
              <dl className="grid">
                <KeyValue label="Email">{detail.email}</KeyValue>
                <KeyValue label="Phone">{detail.phone ?? "Not provided"}</KeyValue>
                <KeyValue label="Age">{detail.age ?? "Not provided"}</KeyValue>
                <KeyValue label="Country">{detail.country}</KeyValue>
                <KeyValue label="Native language">{detail.native_language}</KeyValue>
                <KeyValue label="Goal">{detail.goal}</KeyValue>
              </dl>
            </SectionCard>

            <SectionCard title="Account" description="Status and history">
              <dl className="grid">
                <KeyValue label="Plan">
                  <PlanBadge plan={detail.plan} />
                </KeyValue>
                <KeyValue label="Status">
                  <LearnerStatusBadge status={detail.status} />
                </KeyValue>
                <KeyValue label="Level">
                  <LevelBadge level={detail.level} />
                </KeyValue>
                <KeyValue label="Joined">{formatDate(detail.joined_at)}</KeyValue>
                <KeyValue label="Last active">{formatRelative(detail.last_active_at, NOW)}</KeyValue>
                <KeyValue label="Lessons completed">{formatNumber(detail.lessons_completed)}</KeyValue>
                <KeyValue label="This week">{detail.minutes_this_week} minutes</KeyValue>
              </dl>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="learning">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <SectionCard title="Skill progress" description={`Overall mastery ${detail.overall_mastery}%`}>
              <ul className="grid gap-4">
                {detail.skills.map((skill) => (
                  <li key={skill.skill}>
                    <Meter
                      label={
                        <span className="flex items-center gap-2">
                          {skillLabels[skill.skill]}
                          <span className="text-caption text-fg-muted">{skill.level}</span>
                        </span>
                      }
                      value={skill.mastery}
                      display={`${skill.mastery}%`}
                      tone={skill.mastery > 70 ? "success" : skill.mastery < 35 ? "warning" : "primary"}
                    />
                    <p className="mt-1 text-caption text-fg-muted">
                      {skill.sessions} sessions ·{" "}
                      {skill.last_activity_at ? `last ${formatRelative(skill.last_activity_at, NOW)}` : "never practised"}
                    </p>
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard title="Weak points" description="Where accuracy is lowest">
              <ul className="grid gap-3">
                {detail.weaknesses.map((weakness) => (
                  <li key={weakness.topic} className="grid gap-1 rounded-lg border bg-surface p-3">
                    <p className="text-body-sm font-medium">{weakness.topic}</p>
                    <p className="text-caption text-fg-muted">
                      {skillLabels[weakness.skill]} · {weakness.accuracy}% accuracy over {weakness.attempts} attempts
                    </p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <SectionCard title="Recent activity" description="The last sessions on this account">
            <ol className="grid gap-3">
              {detail.activity.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-body-sm">{event.title}</p>
                    <p className="text-caption text-fg-muted">{event.detail}</p>
                  </div>
                  <span className="shrink-0 text-caption text-fg-muted">{formatRelative(event.created_at, NOW)}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
        </TabsContent>

        <TabsContent value="subscription">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Subscription" description="Plan and billing">
              <dl className="grid">
                <KeyValue label="Plan">
                  <PlanBadge plan={detail.subscription.plan} />
                </KeyValue>
                <KeyValue label="Status">{detail.subscription.status}</KeyValue>
                <KeyValue label="Started">{formatDate(detail.subscription.started_at)}</KeyValue>
                <KeyValue label="Renews">
                  {detail.subscription.renews_at ? formatDate(detail.subscription.renews_at) : "—"}
                </KeyValue>
                <KeyValue label="Amount">
                  {detail.subscription.amount_cents > 0 ? `${formatCurrency(detail.subscription.amount_cents)} / month` : "Free plan"}
                </KeyValue>
                <KeyValue label="Provider">{detail.subscription.provider}</KeyValue>
              </dl>
            </SectionCard>

            <SectionCard title="Plan history" description="Every change on this account">
              {detail.subscription.history.length === 0 ? (
                <p className="text-body-sm text-fg-muted">This learner has always been on the free plan.</p>
              ) : (
                <ol className="grid gap-3">
                  {detail.subscription.history.map((change) => (
                    <li key={change.id} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-body-sm">
                        <CreditCard className="size-4 text-fg-muted" aria-hidden />
                        {planLabels[change.from_plan]} → {planLabels[change.to_plan]}
                      </span>
                      <span className="text-caption text-fg-muted">{formatDate(change.changed_at)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={suspending}
        onOpenChange={setSuspending}
        title={`Suspend ${detail.name}?`}
        description="They will be signed out and cannot open lessons until the account is reactivated."
        confirmLabel="Suspend"
        destructive
        loading={updateStatus.isPending}
        onConfirm={() => {
          updateStatus.mutate(
            { id: detail.id, status: "suspended" },
            { onSuccess: () => toast({ title: `${detail.name} suspended`, variant: "success" }) },
          );
          setSuspending(false);
        }}
      />
    </>
  );
}
