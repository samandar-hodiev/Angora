"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CreditCard, Users, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { BarList } from "../components/charts";
import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import {
  FilterBar,
  FilterSelect,
  OwnerPageHeader,
  SearchInput,
  SectionCard,
} from "../components/primitives";
import { usePayments, useRevenue } from "../hooks";
import { formatDateTime, formatNumber } from "../lib/format";
import type { PaymentRow, PaymentStatus, RevenueDay } from "../types";

/**
 * Money, as it actually arrived.
 *
 * Every number here is counted from payment_transactions — what a provider confirmed — and
 * never from a plan price multiplied by a subscriber count. Those two disagree the moment a
 * price changes, and only one of them is what is in the bank.
 *
 * Nothing on this page can change a payment. A payment is a record of something that
 * happened; refunds belong in the provider's own console, where they are actually executed.
 */

const statusOptions = [
  { value: "all", label: "All payments" },
  { value: "paid", label: "Paid" },
  { value: "prepared", label: "Awaiting confirmation" },
  { value: "created", label: "Started" },
  { value: "canceled", label: "Cancelled" },
  { value: "failed", label: "Failed" },
];

const rangeOptions = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

const statusTone: Record<PaymentStatus, "success" | "secondary" | "outline" | "destructive"> = {
  paid: "success",
  prepared: "outline",
  created: "secondary",
  canceled: "secondary",
  failed: "destructive",
};

/** So'm, from tiyin. Uzbek prices are written with thin spaces, not commas. */
function formatSum(minor: number): string {
  return `${new Intl.NumberFormat("en-US").format(Math.round(minor / 100)).replace(/,/g, " ")} so'm`;
}

export function OwnerPaymentsView() {
  const [days, setDays] = useState("30");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const revenue = useRevenue(Number(days));
  const query = useMemo(() => ({ status, q: search, page }), [status, search, page]);
  const payments = usePayments(query);

  const columns: Column<PaymentRow>[] = [
    {
      key: "when",
      header: "When",
      cell: (row) => <span className="text-fg-muted tabular-nums">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "learner",
      header: "Learner",
      cell: (row) => <span className="truncate">{row.learner_email}</span>,
    },
    {
      key: "plan",
      header: "Plan",
      cell: (row) => <span className="truncate text-fg-secondary">{row.plan_name}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => <span className="tabular-nums">{formatSum(row.amount_minor)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <span className="grid gap-0.5">
          <Badge variant={statusTone[row.status]}>{row.status}</Badge>
          {row.error_note && <span className="truncate text-caption text-fg-muted">{row.error_note}</span>}
        </span>
      ),
    },
    {
      key: "access",
      header: "Access",
      hideBelow: "md",
      cell: (row) =>
        row.status === "paid" ? (
          row.has_subscription ? (
            <span className="text-caption text-success">Subscription opened</span>
          ) : (
            // Paid but no subscription is the one row in this table worth chasing: the
            // learner was charged and did not get what they paid for.
            <span className="text-caption text-error">Paid, no subscription</span>
          )
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: "provider",
      header: "Via",
      hideBelow: "lg",
      cell: (row) => <span className="text-caption text-fg-muted">{row.provider}</span>,
    },
  ];

  const report = revenue.data;
  const peak = Math.max(1, ...(report?.daily ?? []).map((d) => d.amount_minor));

  return (
    <>
      <OwnerPageHeader
        title="Payments"
        description="What learners actually paid, and whether they got what they paid for."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Payments" }]}
        actions={
          <FilterSelect label="Period" value={days} options={rangeOptions} onChange={setDays} />
        }
      />

      {revenue.isError ? (
        <LiveDataState error={revenue.error} onRetry={() => void revenue.refetch()} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {revenue.isPending
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              : [
                  {
                    label: "Collected",
                    value: formatSum(report?.paid_minor ?? 0),
                    hint: `${formatNumber(report?.payments ?? 0)} payments`,
                    icon: Wallet,
                  },
                  {
                    label: "Paying learners",
                    value: formatNumber(report?.paying_users ?? 0),
                    hint: "distinct accounts in this period",
                    icon: Users,
                  },
                  {
                    label: "Average payment",
                    value: formatSum(report?.average_minor ?? 0),
                    hint: "per completed payment",
                    icon: CreditCard,
                  },
                  {
                    label: "Did not complete",
                    value: `${Math.round((report?.failure_rate ?? 0) * 100)}%`,
                    hint: `${formatNumber((report?.attempts ?? 0) - (report?.payments ?? 0))} of ${formatNumber(report?.attempts ?? 0)} attempts`,
                    icon: AlertTriangle,
                  },
                ].map((card) => (
                  <article key={card.label} className="grid min-w-0 gap-2 rounded-xl border bg-surface p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-label text-fg-muted">{card.label}</h3>
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-active text-fg-muted">
                        <card.icon className="size-3.5" aria-hidden />
                      </span>
                    </div>
                    <p className="text-h3 tabular-nums">{card.value}</p>
                    <p className="truncate text-caption text-fg-muted">{card.hint}</p>
                  </article>
                ))}
          </div>

          {(report?.callback_signature_failures ?? 0) > 0 && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-subtle/40 p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="grid gap-0.5">
                <p className="text-body-sm font-medium">
                  {formatNumber(report?.callback_signature_failures ?? 0)} payment callbacks failed their signature check
                </p>
                <p className="text-caption text-fg-muted">
                  Either the merchant secret no longer matches the one Click holds, or somebody is probing the
                  callback endpoint. Both are worth looking at today.
                </p>
              </div>
            </div>
          )}

          <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <SectionCard title="Daily income" description={`Last ${days} days, in so'm`}>
              {revenue.isPending ? (
                <Skeleton className="h-40" />
              ) : (report?.paid_minor ?? 0) === 0 ? (
                <p className="py-10 text-center text-body-sm text-fg-muted">
                  No payments in this period.
                </p>
              ) : (
                <DailyRevenue days={report?.daily ?? []} peak={peak} />
              )}
            </SectionCard>

            <SectionCard title="By plan" description="Where the money came from">
              {revenue.isPending ? (
                <Skeleton className="h-40" />
              ) : (report?.by_plan.length ?? 0) === 0 ? (
                <p className="py-10 text-center text-body-sm text-fg-muted">Nothing sold yet.</p>
              ) : (
                <BarList
                  items={(report?.by_plan ?? []).map((plan) => ({
                    key: plan.plan_code,
                    label: plan.plan_name,
                    value: plan.amount_minor,
                    display: formatSum(plan.amount_minor),
                    hint: `${formatNumber(plan.payments)} payments`,
                  }))}
                />
              )}
            </SectionCard>
          </div>
        </>
      )}

      <FilterBar
        onReset={() => {
          setStatus("all");
          setSearch("");
          setPage(1);
        }}
        resultLabel={payments.isPending ? undefined : `${formatNumber(payments.data?.total ?? 0)} payments`}
      >
        <SearchInput
          label="Search"
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search by email or plan"
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
      </FilterBar>

      <SectionCard title="Transactions" description="Newest first" bodyClassName="p-0">
        {payments.isError ? (
          <div className="p-4">
            <LiveDataState error={payments.error} onRetry={() => void payments.refetch()} />
          </div>
        ) : payments.isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <DataTable
              caption="Payments"
              columns={columns}
              rows={payments.data?.items ?? []}
              rowKey={(row) => row.id}
              minWidth="62rem"
              empty={<p className="py-8 text-center text-body-sm text-fg-muted">No payments match these filters.</p>}
            />
            <Pagination
              page={payments.data?.page ?? 1}
              totalPages={payments.data?.total_pages ?? 1}
              total={payments.data?.total ?? 0}
              pageSize={25}
              onPageChange={setPage}
              label="payments"
            />
          </>
        )}
      </SectionCard>
    </>
  );
}

/** A bar per day. Days with nothing are drawn flat rather than skipped, so a gap reads as
 *  a quiet day and not as missing data. */
function DailyRevenue({ days, peak }: { days: RevenueDay[]; peak: number }) {
  return (
    <div className="grid gap-3">
      <div className="flex h-36 items-end gap-0.5" role="img" aria-label="Daily income">
        {days.map((day) => (
          <div key={day.date} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t-sm bg-primary/70 transition-colors duration-micro group-hover:bg-primary"
              style={{ height: `${Math.max(day.amount_minor > 0 ? 4 : 1, (day.amount_minor / peak) * 100)}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-surface px-2 py-1 text-caption shadow-sm group-hover:block">
              {new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
              {formatSum(day.amount_minor)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-caption text-fg-muted tabular-nums">
        <span>{days[0] ? new Date(days[0].date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</span>
        <span>
          {days.at(-1) ? new Date(days.at(-1)!.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
        </span>
      </div>
    </div>
  );
}
