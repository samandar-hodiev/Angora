"use client";

import { Ban, RotateCcw, ShieldCheck, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";

import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import {
  ActionMenu,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  LearnerAvatar,
  LevelBadge,
  OwnerPageHeader,
  SearchInput,
  SectionCard,
} from "../components/primitives";
import { useLiveLearners, usePlans, useRoles, useSetLearnerStatus, useSetUserRole } from "../hooks";
import { formatDate, formatNumber, formatRelative } from "../lib/format";
import type { AccountStatus, CEFRLevel, LiveLearnerRow } from "../types";
import { cefrLevels } from "../types";

/**
 * Learner management, on the real accounts table.
 *
 * Suspension here is not a UI state: the API sets the account status and revokes the
 * refresh tokens, so the session cannot be renewed. Role changes are the same — the
 * permission set the API enforces is what moves.
 */

const statusStyles: Record<AccountStatus, string> = {
  active: "border-transparent bg-success/15 text-success",
  suspended: "border-transparent bg-error/15 text-error",
  deleted: "border-transparent bg-surface-active text-fg-muted line-through",
};

const now = () => new Date().toISOString();

export function LearnersView() {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("all");
  const [level, setLevel] = useState<CEFRLevel | "all">("all");
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [sort, setSort] = useState("joined");
  const [page, setPage] = useState(1);

  const [suspending, setSuspending] = useState<LiveLearnerRow | null>(null);
  const [reason, setReason] = useState("");
  const [roleFor, setRoleFor] = useState<LiveLearnerRow | null>(null);
  const [nextRole, setNextRole] = useState("USER");

  const query = useMemo(() => ({ search, plan, level, status, sort, page }), [search, plan, level, status, sort, page]);
  const learners = useLiveLearners(query);
  const plans = usePlans();
  const roles = useRoles();
  const setStatusMutation = useSetLearnerStatus();
  const setRoleMutation = useSetUserRole();

  function reset() {
    setSearch("");
    setPlan("all");
    setLevel("all");
    setStatus("all");
    setSort("joined");
    setPage(1);
  }

  function changeStatus(learner: LiveLearnerRow, next: "active" | "suspended", why?: string) {
    setStatusMutation.mutate(
      { id: learner.id, status: next, reason: why },
      {
        onSuccess: () =>
          toast({
            title: next === "suspended" ? `${learner.email} suspended` : `${learner.email} reactivated`,
            description: next === "suspended" ? "Their sessions were revoked." : undefined,
            variant: "success",
          }),
        onError: (error) =>
          toast({
            title: "That change was refused",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
      },
    );
    setSuspending(null);
    setReason("");
  }

  const columns: Column<LiveLearnerRow>[] = [
    {
      key: "learner",
      header: "Learner",
      width: "20rem",
      cell: (learner) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <LearnerAvatar name={learner.display_name || learner.email} avatarUrl={learner.avatar_url} size="sm" />
          <div className="grid min-w-0">
            <Link href={`/owner/learners/${learner.id}`} className="truncate font-medium hover:underline">
              {learner.display_name || learner.email}
            </Link>
            <span className="truncate text-caption text-fg-muted">{learner.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      cell: (learner) => <Badge variant="outline">{learner.plan_name}</Badge>,
    },
    {
      key: "level",
      header: "Level",
      hideBelow: "md",
      cell: (learner) =>
        learner.current_level ? <LevelBadge level={learner.current_level} /> : <span className="text-fg-muted">—</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (learner) => (
        <span className="flex items-center gap-1.5">
          <Badge className={statusStyles[learner.status]}>{learner.status}</Badge>
          {learner.role !== "USER" && (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="size-3" aria-hidden />
              {learner.role.toLowerCase().replace("_", " ")}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "onboarded",
      header: "Onboarding",
      hideBelow: "xl",
      cell: (learner) =>
        learner.onboarded ? (
          <span className="text-success">Complete</span>
        ) : (
          <span className="text-fg-muted">Unfinished</span>
        ),
    },
    {
      key: "streak",
      header: "Streak",
      hideBelow: "xl",
      cell: (learner) => <span className="tabular-nums">{learner.streak_days > 0 ? `${learner.streak_days}d` : "—"}</span>,
    },
    {
      key: "joined",
      header: "Joined",
      hideBelow: "lg",
      cell: (learner) => <span className="text-fg-muted tabular-nums">{formatDate(learner.joined_at)}</span>,
    },
    {
      key: "active",
      header: "Last seen",
      hideBelow: "md",
      cell: (learner) => (
        <span className="text-fg-muted">
          {learner.last_active_at ? formatRelative(learner.last_active_at, now()) : "Never"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      srOnlyHeader: true,
      width: "3rem",
      cell: (learner) => (
        <ActionMenu
          label={`Actions for ${learner.email}`}
          items={[
            { label: "Open profile", icon: UserRound, href: `/owner/learners/${learner.id}` },
            {
              label: "Change role",
              icon: ShieldCheck,
              separatorBefore: true,
              onSelect: () => {
                setNextRole(learner.role);
                setRoleFor(learner);
              },
            },
            learner.status === "suspended"
              ? { label: "Reactivate", icon: RotateCcw, onSelect: () => changeStatus(learner, "active") }
              : { label: "Suspend account", icon: Ban, destructive: true, onSelect: () => setSuspending(learner) },
          ]}
        />
      ),
    },
  ];

  const total = learners.data?.total ?? 0;

  return (
    <>
      <OwnerPageHeader
        title="Learners"
        description="Every account on the platform, with plan, level and activity."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Learners" }]}
      />

      <FilterBar onReset={reset} resultLabel={learners.isPending ? undefined : `${formatNumber(total)} accounts`}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search learners"
          placeholder="Search name or email"
        />
        <FilterSelect
          label="Plan"
          value={plan}
          options={[
            { value: "all", label: "All plans" },
            ...(plans.data ?? []).map((p) => ({ value: p.code, label: p.name })),
          ]}
          onChange={(value) => {
            setPlan(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Level"
          value={level}
          options={[{ value: "all" as const, label: "All levels" }, ...cefrLevels.map((l) => ({ value: l, label: l }))]}
          onChange={(value) => {
            setLevel(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={[
            { value: "all" as const, label: "All statuses" },
            { value: "active" as const, label: "Active" },
            { value: "suspended" as const, label: "Suspended" },
            { value: "deleted" as const, label: "Deleted" },
          ]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          options={[
            { value: "joined", label: "Newest first" },
            { value: "last_active", label: "Recently active" },
            { value: "email", label: "Email A–Z" },
          ]}
          onChange={setSort}
        />
      </FilterBar>

      <SectionCard title="All learners" description="Live from the platform database" bodyClassName="p-0">
        {learners.isError ? (
          <div className="p-4">
            <LiveDataState error={learners.error} onRetry={() => void learners.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              caption="Learner accounts"
              columns={columns}
              rows={learners.data?.items ?? []}
              rowKey={(learner) => learner.id}
              isLoading={learners.isPending}
              minWidth="68rem"
              empty={
                <div className="grid justify-items-center gap-3 py-6 text-center">
                  <Users className="size-8 text-fg-muted" aria-hidden />
                  <div>
                    <p className="text-h4">No accounts match these filters</p>
                    <p className="text-body-sm text-fg-secondary">Clear the filters to see everyone.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={reset}>
                    Clear filters
                  </Button>
                </div>
              }
            />
            <Pagination
              page={learners.data?.page ?? 1}
              totalPages={learners.data?.total_pages ?? 1}
              total={total}
              pageSize={20}
              onPageChange={setPage}
              label="accounts"
            />
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={suspending !== null}
        onOpenChange={(open) => !open && setSuspending(null)}
        title={suspending ? `Suspend ${suspending.email}?` : ""}
        description="Their sessions are revoked immediately and they cannot sign in again until the account is reactivated."
        confirmLabel="Suspend"
        destructive
        loading={setStatusMutation.isPending}
        onConfirm={() => suspending && changeStatus(suspending, "suspended", reason)}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="suspend-reason">Reason (recorded in the audit log)</Label>
          <Textarea
            id="suspend-reason"
            rows={2}
            value={reason}
            placeholder="Abusive content in speaking submissions"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={roleFor !== null}
        onOpenChange={(open) => !open && setRoleFor(null)}
        title={roleFor ? `Change role for ${roleFor.email}` : ""}
        description="A role is a bundle of permissions the API enforces on every request."
        confirmLabel="Change role"
        loading={setRoleMutation.isPending}
        onConfirm={() => {
          if (!roleFor) return;
          setRoleMutation.mutate(
            { id: roleFor.id, role: nextRole },
            {
              onSuccess: () => toast({ title: `${roleFor.email} is now ${nextRole}`, variant: "success" }),
              onError: (error) =>
                toast({
                  title: "That change was refused",
                  description: isApiError(error) ? error.message : undefined,
                  variant: "error",
                }),
            },
          );
          setRoleFor(null);
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="next-role">Role</Label>
          <NativeSelect id="next-role" value={nextRole} onChange={(event) => setNextRole(event.target.value)}>
            {(roles.data ?? []).map((role) => (
              <option key={role.role} value={role.role}>
                {role.role}
              </option>
            ))}
          </NativeSelect>
          <ul className="grid gap-0.5 rounded-lg border bg-surface-hover p-3 text-caption text-fg-muted">
            {(roles.data ?? []).find((role) => role.role === nextRole)?.permissions.map((permission) => (
              <li key={permission}>
                <code className="font-mono">{permission}</code>
              </li>
            )) ?? <li>No permissions</li>}
          </ul>
        </div>
      </ConfirmDialog>
    </>
  );
}
