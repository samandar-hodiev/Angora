"use client";

import { Check, Lock, Minus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CheckoutButton } from "@/features/payments/components/checkout";

import { useCurrentSubscription, useFeature, usePlans } from "../hooks";
import { describeEntitlement, formatPlanPrice, usagePercent } from "../lib/entitlements";

/** Renders children only when the current plan includes `feature` (from the API). */
export function EntitlementGate({ feature, children, fallback }: { feature: string; children: ReactNode; fallback?: ReactNode }) {
  const { allowed, isPending, isError, error, refetch } = useFeature(feature);
  if (isPending) return <Skeleton className="h-40 rounded-xl" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!allowed) return fallback ?? <UpgradePrompt />;
  return children;
}

export function UpgradePrompt() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-surface p-6 sm:flex-row sm:items-center">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
        <Lock className="size-4" aria-hidden />
      </span>
      <div className="flex-1">
        <p className="text-h4">Not included in your plan</p>
        <p className="text-body-sm text-fg-secondary">Upgrade to unlock this part of Engora.</p>
      </div>
      <Button asChild>
        <Link href="/app/subscription">See plans</Link>
      </Button>
    </div>
  );
}

export function CurrentPlan() {
  const current = useCurrentSubscription();
  const plans = usePlans();

  if (current.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (current.isError) return <ErrorState title="Couldn't load your plan" error={current.error} onRetry={() => void current.refetch()} />;

  const { entitlements } = current.data;
  const catalogue = new Map<string, string>();
  plans.data?.forEach((p) => p.entitlements.forEach((e) => e.kind === "feature" && catalogue.set(e.key, e.description)));
  const limits = Object.entries(entitlements.limits);

  return (
    <div className="grid gap-6 rounded-xl border bg-surface p-6 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        <div>
          <p className="text-label text-fg-muted">Your current plan</p>
          <p className="flex items-center gap-2 text-h1">
            {entitlements.plan_name}
            <Badge variant={entitlements.status === "free" ? "secondary" : "success"}>{entitlements.status}</Badge>
          </p>
        </div>
        <ul className="grid gap-2">
          {[...catalogue.entries()].map(([key, description]) => {
            const included = entitlements.features.includes(key);
            return (
              <li key={key} className={cn("flex items-center gap-2 text-body-sm", !included && "text-fg-muted")}>
                {included ? <Check className="size-4 text-success" aria-label="Included" /> : <Minus className="size-4" aria-label="Not included" />}
                {description}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid content-start gap-4 rounded-lg bg-surface-hover p-5">
        <p className="text-label text-fg-muted">Usage</p>
        {limits.length === 0 && <p className="text-body-sm text-fg-muted">No metered features on this plan.</p>}
        {limits.map(([key, limit]) => (
          <Meter key={key} label={limit.label} value={usagePercent(limit)} display={limit.limit === null ? "Unlimited" : `${limit.used} / ${limit.limit} per ${limit.period}`} />
        ))}
      </div>
    </div>
  );
}

export function PlanList() {
  const plans = usePlans();
  const current = useCurrentSubscription();

  if (plans.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-96 rounded-xl" />
        ))}
      </div>
    );
  }
  if (plans.isError) return <ErrorState title="Couldn't load plans" error={plans.error} onRetry={() => void plans.refetch()} />;

  const currentCode = current.data?.entitlements.plan_code;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {plans.data.map((plan) => {
        const isCurrent = plan.code === currentCode;
        return (
          <article key={plan.id} className={cn("flex flex-col gap-5 rounded-xl border bg-surface p-6", isCurrent && "border-primary ring-1 ring-primary")}>
            <div className="grid gap-1.5">
              <h3 className="flex items-center gap-2 text-h3">
                {plan.name}
                {isCurrent && <Badge>Current</Badge>}
              </h3>
              <p className="text-body-sm text-fg-secondary">{plan.description}</p>
            </div>
            <div>
              <p className="text-h1 tabular-nums">{formatPlanPrice(plan)}</p>
              {plan.trial_days > 0 && <p className="text-caption text-fg-muted">{plan.trial_days}-day free trial</p>}
            </div>
            <ul className="grid gap-2 text-body-sm">
              {plan.entitlements.map((e) => (
                <li key={e.key} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <span>{describeEntitlement(e)}</span>
                </li>
              ))}
            </ul>
            <CheckoutButton
              className="mt-auto w-full"
              planCode={plan.code}
              planName={plan.name}
              payable={Boolean(plan.price_uzs && plan.price_uzs > 0)}
              isCurrent={isCurrent}
            />
          </article>
        );
      })}
    </div>
  );
}
