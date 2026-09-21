"use client";

import { Ban, CreditCard, Eye, RotateCcw, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

import { DataTable, Pagination, type Column } from "../components/data-table";
import {
  ActionMenu,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  LearnerAvatar,
  LearnerStatusBadge,
  LevelBadge,
  OwnerPageHeader,
  PlanBadge,
  SearchInput,
  SectionCard,
} from "../components/primitives";
import { useLearners, useUpdateLearnerPlan, useUpdateLearnerStatus } from "../hooks";
import { formatDate, formatNumber, formatRelative, planLabels } from "../lib/format";
import { MOCK_TODAY } from "../lib/mock";
import type { CEFRLevel, Learner, LearnerStatus, PlanCode, PlanFilter } from "../types";
import { cefrLevels, planCodes } from "../types";

const PAGE_SIZE = 20;
const NOW = `${MOCK_TODAY}T12:00:00Z`;

const planOptions = [
  { value: "all" as const, label: "All plans" },
  ...planCodes.map((plan) => ({ value: plan, label: planLabels[plan] })),
];

const levelOptions = [{ value: "all" as const, label: "All levels" }, ...cefrLevels.map((level) => ({ value: level, label: level }))];

const statusOptions = [
  { value: "all" as const, label: "All statuses" },
  { value: "active" as const, label: "Active" },
  { value: "suspended" as const, label: "Suspended" },
  { value: "pending" as const, label: "Pending" },
  { value: "archived" as const, label: "Archived" },
];

const sortOptions = [
  { value: "joined" as const, label: "Newest first" },
  { value: "last_active" as const, label: "Recently active" },
  { value: "name" as const, label: "Name A–Z" },
];

export function LearnersView() {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<PlanFilter>("all");
  const [level, setLevel] = useState<CEFRLevel | "all">("all");
  const [status, setStatus] = useState<LearnerStatus | "all">("all");
  const [sort, setSort] = useState<"joined" | "last_active" | "name">("joined");
  const [page, setPage] = useState(1);

  const [planChange, setPlanChange] = useState<Learner | null>(null);
  const [nextPlan, setNextPlan] = useState<PlanCode>("premium");
  const [suspending, setSuspending] = useState<Learner | null>(null);

  const query = useMemo(
    () => ({ search, plan, level, status, sort, page, page_size: PAGE_SIZE }),
    [search, plan, level, status, sort, page],
  );
  const learners = useLearners(query);
  const updatePlan = useUpdateLearnerPlan();
  const updateStatus = useUpdateLearnerStatus();

  function reset() {
    setSearch("");
    setPlan("all");
    setLevel("all");
    setStatus("all");
    setSort("joined");
    setPage(1);
  }

  const columns: Column<Learner>[] = [
    {
      key: "learner",
      header: "Learner",
      width: "18rem",
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
    {
      key: "phone",
      header: "Phone",
      hideBelow: "xl",
      cell: (learner) => <span className="text-fg-secondary tabular-nums">{learner.phone ?? "—"}</span>,
    },
    {
      key: "age",
      header: "Age",
      hideBelow: "xl",
      cell: (learner) => <span className="tabular-nums">{learner.age ?? "—"}</span>,
    },
    { key: "level", header: "Level", hideBelow: "sm", cell: (learner) => <LevelBadge level={learner.level} /> },
    { key: "plan", header: "Plan", cell: (learner) => <PlanBadge plan={learner.plan} /> },
    { key: "status", header: "Status", hideBelow: "md", cell: (learner) => <LearnerStatusBadge status={learner.status} /> },
    {
      key: "joined",
      header: "Joined",
      hideBelow: "lg",
      cell: (learner) => <span className="text-fg-muted tabular-nums">{formatDate(learner.joined_at)}</span>,
    },
    {
      key: "active",
      header: "Last active",
      hideBelow: "md",
      cell: (learner) => <span className="text-fg-muted">{formatRelative(learner.last_active_at, NOW)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      srOnlyHeader: true,
      width: "3rem",
      cell: (learner) => (
        <ActionMenu
          label={`Actions for ${learner.name}`}
          items={[
            { label: "View profile", icon: UserRound, href: `/owner/learners/${learner.id}` },
            {
              label: "Change plan",
              icon: CreditCard,
              separatorBefore: true,
              onSelect: () => {
                setNextPlan(learner.plan === "free" ? "premium" : learner.plan === "premium" ? "unlimited" : "free");
                setPlanChange(learner);
              },
            },
            learner.status === "suspended"
              ? { label: "Reactivate", icon: RotateCcw, onSelect: () => reactivate(learner) }
              : { label: "Suspend account", icon: Ban, destructive: true, onSelect: () => setSuspending(learner) },
          ]}
        />
      ),
    },
  ];

  function reactivate(learner: Learner) {
    updateStatus.mutate(
      { id: learner.id, status: "active" },
      { onSuccess: () => toast({ title: `${learner.name} reactivated`, variant: "success" }) },
    );
  }

  const total = learners.data?.total ?? 0;

  return (
    <>
      <OwnerPageHeader
        title="Learners"
        description="Every account on the platform, with plan, level and activity."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Learners" }]}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/owner/analytics">
              <Eye aria-hidden />
              Analytics
            </Link>
          </Button>
        }
      />

      <FilterBar onReset={reset} resultLabel={learners.isPending ? undefined : `${formatNumber(total)} learners`}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search learners"
          placeholder="Search by name or email"
        />
        <FilterSelect
          label="Plan"
          value={plan}
          options={planOptions}
          onChange={(value) => {
            setPlan(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Level"
          value={level}
          options={levelOptions}
          onChange={(value) => {
            setLevel(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={statusOptions}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <FilterSelect label="Sort" value={sort} options={sortOptions} onChange={setSort} />
      </FilterBar>

      <SectionCard title="All learners" description="Click a row to open the full profile" bodyClassName="p-0">
        <DataTable
          caption="Learner accounts"
          columns={columns}
          rows={learners.data?.items ?? []}
          rowKey={(learner) => learner.id}
          isLoading={learners.isPending}
          isError={learners.isError}
          error={learners.error}
          onRetry={() => void learners.refetch()}
          minWidth="62rem"
          empty={
            <EmptyState
              icon={Users}
              title="No learners match these filters"
              description="Try another plan or status, or clear the search."
              action={
                <Button variant="outline" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          }
        />
        <Pagination
          page={learners.data?.page ?? 1}
          totalPages={learners.data?.total_pages ?? 1}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          label="learners"
        />
      </SectionCard>

      <ConfirmDialog
        open={planChange !== null}
        onOpenChange={(open) => !open && setPlanChange(null)}
        title={planChange ? `Change ${planChange.name}'s plan?` : ""}
        description="The learner keeps their progress; only what they can reach changes."
        confirmLabel="Change plan"
        loading={updatePlan.isPending}
        onConfirm={() => {
          if (!planChange) return;
          updatePlan.mutate(
            { id: planChange.id, plan: nextPlan },
            {
              onSuccess: () =>
                toast({ title: `${planChange.name} moved to ${planLabels[nextPlan]}`, variant: "success" }),
            },
          );
          setPlanChange(null);
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="next-plan">New plan</Label>
          <NativeSelect id="next-plan" value={nextPlan} onChange={(event) => setNextPlan(event.target.value as PlanCode)}>
            {planCodes.map((code) => (
              <option key={code} value={code}>
                {planLabels[code]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-caption text-fg-muted">
            Mock change — billing is untouched until the payment provider is connected.
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={suspending !== null}
        onOpenChange={(open) => !open && setSuspending(null)}
        title={suspending ? `Suspend ${suspending.name}?` : ""}
        description="They will be signed out and cannot open lessons until the account is reactivated."
        confirmLabel="Suspend"
        destructive
        loading={updateStatus.isPending}
        onConfirm={() => {
          if (!suspending) return;
          updateStatus.mutate(
            { id: suspending.id, status: "suspended" },
            { onSuccess: () => toast({ title: `${suspending.name} suspended`, variant: "success" }) },
          );
          setSuspending(null);
        }}
      />
    </>
  );
}
