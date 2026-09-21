"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import { FilterBar, FilterSelect, OwnerPageHeader, SectionCard } from "../components/primitives";
import { useAuditLogs } from "../hooks";
import { formatDateTime, formatNumber } from "../lib/format";
import type { AuditRow } from "../types";

/**
 * Who changed what.
 *
 * Read-only by design: an audit trail an operator can edit is not an audit trail. Entries are
 * written by the API as a side effect of the change itself, so nothing that changed the
 * platform can be missing from here.
 */

const entityOptions = [
  { value: "all", label: "Everything" },
  { value: "assessment_item", label: "Questions" },
  { value: "assessment_config", label: "Test configuration" },
  { value: "plan_entitlement", label: "Paywall" },
  { value: "user", label: "Accounts" },
  { value: "profile", label: "Profiles" },
];

const rangeOptions = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

export function OwnerAuditView() {
  const [entity, setEntity] = useState("all");
  const [days, setDays] = useState("30");
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({ entity: entity === "all" ? undefined : entity, days: Number(days), page }),
    [entity, days, page],
  );
  const logs = useAuditLogs(query);

  const columns: Column<AuditRow>[] = [
    {
      key: "when",
      header: "When",
      cell: (row) => <span className="text-fg-muted tabular-nums">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "actor",
      header: "Who",
      cell: (row) => <span className="truncate">{row.actor_email ?? "System"}</span>,
    },
    {
      key: "action",
      header: "Action",
      cell: (row) => (
        <Badge variant="outline" className="font-mono text-caption">
          {row.action}
        </Badge>
      ),
    },
    {
      key: "entity",
      header: "Target",
      hideBelow: "md",
      cell: (row) => (
        <span className="grid gap-0.5">
          <span className="text-fg-secondary">{row.entity_type}</span>
          <code className="truncate font-mono text-caption text-fg-muted">{row.entity_id}</code>
        </span>
      ),
    },
    {
      key: "detail",
      header: "Detail",
      hideBelow: "lg",
      cell: (row) => {
        const entries = Object.entries(row.metadata ?? {}).filter(([, value]) => value !== null && value !== "");
        if (entries.length === 0) return <span className="text-fg-muted">—</span>;
        return (
          <span className="grid gap-0.5 text-caption text-fg-muted">
            {entries.slice(0, 3).map(([key, value]) => (
              <span key={key}>
                {key}: <span className="text-fg-secondary">{String(value)}</span>
              </span>
            ))}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <OwnerPageHeader
        title="Audit log"
        description="Every change an operator made to the platform."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Audit log" }]}
      />

      <FilterBar
        onReset={() => {
          setEntity("all");
          setDays("30");
          setPage(1);
        }}
        resultLabel={logs.isPending ? undefined : `${formatNumber(logs.data?.total ?? 0)} entries`}
      >
        <FilterSelect
          label="Area"
          value={entity}
          options={entityOptions}
          onChange={(value) => {
            setEntity(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Period"
          value={days}
          options={rangeOptions}
          onChange={(value) => {
            setDays(value);
            setPage(1);
          }}
        />
      </FilterBar>

      <SectionCard title="Changes" description="Newest first" bodyClassName="p-0">
        {logs.isError ? (
          <div className="p-4">
            <LiveDataState error={logs.error} onRetry={() => void logs.refetch()} />
          </div>
        ) : logs.isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <DataTable
              caption="Audit log"
              columns={columns}
              rows={logs.data?.items ?? []}
              rowKey={(row) => row.id}
              minWidth="58rem"
              empty={
                <p className="py-8 text-center text-body-sm text-fg-muted">
                  No changes recorded in this period.
                </p>
              }
            />
            <Pagination
              page={logs.data?.page ?? 1}
              totalPages={logs.data?.total_pages ?? 1}
              total={logs.data?.total ?? 0}
              pageSize={25}
              onPageChange={setPage}
              label="entries"
            />
          </>
        )}
      </SectionCard>
    </>
  );
}
