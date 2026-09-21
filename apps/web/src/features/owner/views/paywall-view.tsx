"use client";

import { Check, Eye, Infinity as InfinityIcon, Lock, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { DataTable, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import {
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  OwnerPageHeader,
  SearchInput,
  SectionCard,
  SegmentedControl,
} from "../components/primitives";
import { useEntitlements, usePlans, useRevokePlanEntitlement, useSetPlanEntitlement } from "../hooks";
import { formatCurrency, formatNumber } from "../lib/format";
import type { EntitlementRow, LimitPeriod, PlanRow } from "../types";

/**
 * Feature access.
 *
 * This is the live configuration, not a picture of one: the rows are the `entitlements` table
 * and the columns are the plans, and the same two tables are what the API reads on every
 * learner request. Changing a cell here changes what a learner can reach on their next call —
 * there is no deploy and no second copy of the rules.
 */

type Access =
  | { kind: "none" }
  | { kind: "feature" }
  | { kind: "unlimited" }
  | { kind: "limited"; value: number; period: LimitPeriod };

function accessFor(plan: PlanRow, key: string): Access {
  const granted = plan.entitlements.find((entry) => entry.key === key);
  if (!granted) return { kind: "none" };
  if (granted.kind === "feature") return { kind: "feature" };
  if (granted.limit_value === null) return { kind: "unlimited" };
  return { kind: "limited", value: granted.limit_value, period: granted.limit_period ?? "month" };
}

function AccessCell({ access, emphasis }: { access: Access; emphasis: boolean }) {
  const base = cn("inline-flex items-center gap-1.5 text-body-sm", emphasis && "font-medium");
  switch (access.kind) {
    case "none":
      return (
        <span className={cn(base, "text-fg-muted")}>
          <X className="size-3.5" aria-hidden />
          Locked
        </span>
      );
    case "feature":
      return (
        <span className={cn(base, "text-success")}>
          <Check className="size-3.5" aria-hidden />
          Included
        </span>
      );
    case "unlimited":
      return (
        <span className={cn(base, "text-success")}>
          <InfinityIcon className="size-3.5" aria-hidden />
          Unlimited
        </span>
      );
    default:
      return (
        <span className={cn(base, "tabular-nums")}>
          {formatNumber(access.value)}
          <span className="text-fg-muted">/ {access.period}</span>
        </span>
      );
  }
}

export function PaywallView() {
  const plansQuery = usePlans();
  const entitlementsQuery = useEntitlements();

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "feature" | "limit">("all");
  const [previewPlan, setPreviewPlan] = useState<string>("free");
  const [editing, setEditing] = useState<{ entitlement: EntitlementRow; plan: PlanRow } | null>(null);
  const [previewing, setPreviewing] = useState<EntitlementRow | null>(null);

  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);

  const rows = useMemo(() => {
    let items = entitlementsQuery.data ?? [];
    if (search) {
      const needle = search.toLowerCase();
      items = items.filter(
        (entry) => entry.key.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle),
      );
    }
    if (kind !== "all") items = items.filter((entry) => entry.kind === kind);
    return items;
  }, [entitlementsQuery.data, search, kind]);

  const previewed = plans.find((plan) => plan.code === previewPlan) ?? plans[0];

  const columns: Column<EntitlementRow>[] = [
    {
      key: "feature",
      header: "Feature",
      width: "22rem",
      cell: (entry) => (
        <div className="grid min-w-0 gap-0.5">
          <span className="font-medium">{entry.description || entry.key}</span>
          <code className="truncate font-mono text-caption text-fg-muted">{entry.key}</code>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Type",
      hideBelow: "lg",
      cell: (entry) => (
        <Badge variant="outline">{entry.kind === "feature" ? "Access" : "Metered"}</Badge>
      ),
    },
    ...plans.map<Column<EntitlementRow>>((plan) => ({
      key: plan.code,
      header: plan.name,
      cell: (entry) => <AccessCell access={accessFor(plan, entry.key)} emphasis={plan.code === previewPlan} />,
    })),
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (entry) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setPreviewing(entry)}>
            <Eye aria-hidden />
            <span className="sr-only sm:not-sr-only">Preview</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!previewed}
            onClick={() => previewed && setEditing({ entitlement: entry, plan: previewed })}
          >
            <Pencil aria-hidden />
            <span className="sr-only sm:not-sr-only">Edit</span>
          </Button>
        </div>
      ),
    },
  ];

  const failed = plansQuery.isError || entitlementsQuery.isError;

  return (
    <>
      <OwnerPageHeader
        title="Feature access"
        description="Control which learner features each plan includes, and how much of them learners get."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Paywall" }]}
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <SectionCard title="How this works" description="One configuration, enforced server-side">
          <p className="text-body-sm text-fg-secondary">
            Nothing in the learner app checks a plan name. Each feature has an entitlement key, and the API asks
            whether the learner holds that key and how much of its budget is left. A change here reaches learners on
            their next request.
          </p>
          <p className="mt-2 text-caption text-fg-muted">
            Metered features reserve their unit before the work runs and refund it if the work fails, so a learner is
            never charged for an answer they did not get.
          </p>
        </SectionCard>

        <SectionCard title="Plans" description="Live from the catalogue">
          {plansQuery.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : failed ? (
            <LiveDataState error={plansQuery.error} onRetry={() => void plansQuery.refetch()} />
          ) : (
            <ul className="grid gap-2">
              {plans.map((plan) => (
                <li key={plan.id} className="flex items-baseline justify-between gap-3 text-body-sm">
                  <span className="flex items-center gap-2">
                    {plan.name}
                    {plan.is_default && <Badge variant="outline">default</Badge>}
                  </span>
                  <span className="text-fg-muted tabular-nums">
                    {plan.price_cents === 0 ? "Free" : `${formatCurrency(plan.price_cents)} / ${plan.billing_interval}`}
                    {" · "}
                    {formatNumber(plan.subscribers)} subscribers
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Preview and edit against plan"
          value={previewPlan}
          options={plans.map((plan) => ({ value: plan.code, label: plan.name }))}
          onChange={setPreviewPlan}
        />
        <span className="text-caption text-fg-muted">
          Edits and previews apply to <strong className="font-medium text-foreground">{previewed?.name ?? "—"}</strong>.
        </span>
      </div>

      <FilterBar
        onReset={() => {
          setSearch("");
          setKind("all");
        }}
        resultLabel={entitlementsQuery.isPending ? undefined : `${rows.length} features`}
      >
        <SearchInput value={search} onChange={setSearch} label="Search features" placeholder="Search features" />
        <FilterSelect
          label="Type"
          value={kind}
          options={[
            { value: "all" as const, label: "All types" },
            { value: "feature" as const, label: "Access" },
            { value: "limit" as const, label: "Metered" },
          ]}
          onChange={setKind}
        />
      </FilterBar>

      <SectionCard title="Features" description="Access per plan" bodyClassName="p-0">
        {failed ? (
          <div className="p-4">
            <LiveDataState error={entitlementsQuery.error ?? plansQuery.error} onRetry={() => void entitlementsQuery.refetch()} />
          </div>
        ) : (
          <DataTable
            caption="Feature access per plan"
            columns={columns}
            rows={rows}
            rowKey={(entry) => entry.key}
            isLoading={entitlementsQuery.isPending || plansQuery.isPending}
            minWidth="62rem"
            empty={
              <p className="py-6 text-center text-body-sm text-fg-muted">
                No entitlement matches these filters.
              </p>
            }
          />
        )}
      </SectionCard>

      {editing && (
        <EditAccessDialog
          entitlement={editing.entitlement}
          plan={editing.plan}
          onClose={() => setEditing(null)}
        />
      )}

      {previewing && previewed && (
        <LearnerPreviewDialog entitlement={previewing} plan={previewed} onClose={() => setPreviewing(null)} />
      )}
    </>
  );
}

function EditAccessDialog({
  entitlement,
  plan,
  onClose,
}: {
  entitlement: EntitlementRow;
  plan: PlanRow;
  onClose: () => void;
}) {
  const current = plan.entitlements.find((entry) => entry.key === entitlement.key);
  const save = useSetPlanEntitlement();
  const revoke = useRevokePlanEntitlement();

  const [mode, setMode] = useState<"locked" | "unlimited" | "limited">(() => {
    if (!current) return "locked";
    if (entitlement.kind === "feature" || current.limit_value === null) return "unlimited";
    return "limited";
  });
  const [value, setValue] = useState(String(current?.limit_value ?? 10));
  const [period, setPeriod] = useState<LimitPeriod>(current?.limit_period ?? "month");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const isFeature = entitlement.kind === "feature";

  function apply() {
    if (mode === "locked") {
      setConfirmRevoke(true);
      return;
    }
    save.mutate(
      {
        planId: plan.id,
        key: entitlement.key,
        limit_value: isFeature || mode === "unlimited" ? null : Math.max(0, Number(value) || 0),
        limit_period: isFeature || mode === "unlimited" ? null : period,
      },
      {
        onSuccess: () => {
          toast({
            title: `${plan.name}: ${entitlement.description || entitlement.key} updated`,
            description: "Learners see the change on their next request.",
            variant: "success",
          });
          onClose();
        },
        onError: (error) =>
          toast({
            title: "That change was refused",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
      },
    );
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{entitlement.description || entitlement.key}</DialogTitle>
            <DialogDescription>
              What <strong>{plan.name}</strong> learners get. Key: <code className="font-mono">{entitlement.key}</code>
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label">Access</legend>
            {(
              [
                { id: "locked" as const, label: "Locked", hint: "Not part of this plan" },
                {
                  id: "unlimited" as const,
                  label: isFeature ? "Included" : "Unlimited",
                  hint: isFeature ? "Plan includes the feature" : "No cap",
                },
                ...(isFeature ? [] : [{ id: "limited" as const, label: "Limited", hint: "A budget per period" }]),
              ]
            ).map((option) => (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-body-sm transition-colors duration-micro",
                  mode === option.id ? "border-primary bg-primary-subtle" : "hover:bg-surface-hover",
                )}
              >
                <input
                  type="radio"
                  name="access"
                  checked={mode === option.id}
                  onChange={() => setMode(option.id)}
                  className="size-4 accent-[var(--primary)]"
                />
                <span className="grid gap-0.5">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-caption text-fg-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === "limited" && !isFeature && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="limit-value">Budget</Label>
                <Input
                  id="limit-value"
                  inputMode="numeric"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="limit-period">Per</Label>
                <NativeSelect
                  id="limit-period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value as LimitPeriod)}
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="lifetime">Lifetime</option>
                </NativeSelect>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={save.isPending || revoke.isPending} onClick={apply}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={`Remove this from ${plan.name}?`}
        description="Learners on this plan lose access immediately. Usage already recorded is kept."
        confirmLabel="Remove access"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          revoke.mutate(
            { planId: plan.id, key: entitlement.key },
            {
              onSuccess: () => {
                toast({ title: `Removed from ${plan.name}`, variant: "success" });
                setConfirmRevoke(false);
                onClose();
              },
              onError: (error) =>
                toast({
                  title: "That change was refused",
                  description: isApiError(error) ? error.message : undefined,
                  variant: "error",
                }),
            },
          );
        }}
      />
    </>
  );
}

/** Exactly what a learner on this plan meets when they reach for the feature. */
function LearnerPreviewDialog({
  entitlement,
  plan,
  onClose,
}: {
  entitlement: EntitlementRow;
  plan: PlanRow;
  onClose: () => void;
}) {
  const access = accessFor(plan, entitlement.key);
  const locked = access.kind === "none";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entitlement.description || entitlement.key}</DialogTitle>
          <DialogDescription>
            Previewing as a <strong>{plan.name}</strong> learner.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-surface p-6 text-center">
          {locked ? (
            <>
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
                <Lock className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-h4">Not on your plan</p>
              <p className="mt-1 text-body-sm text-fg-secondary">
                The API answers this request with ENTITLEMENT_REQUIRED, and the learner app shows the upgrade prompt.
              </p>
              <Button className="mt-4" disabled>
                Upgrade
              </Button>
            </>
          ) : (
            <>
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-success">
                <Check className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-h4">Available</p>
              <p className="mt-1 text-body-sm text-fg-secondary">
                {access.kind === "limited"
                  ? `${formatNumber(access.value)} per ${access.period}. Past that the API answers USAGE_LIMIT_REACHED and tells the learner when it resets.`
                  : "No cap — the learner is never refused for this feature."}
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
