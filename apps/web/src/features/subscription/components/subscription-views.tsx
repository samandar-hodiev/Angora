"use client";

import { Check, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

import { useCurrentSubscription, useFeature, usePlans } from "../hooks";
import { describeEntitlement, formatPlanPrice, usagePercent } from "../lib/entitlements";

/** Renders children only when the current plan includes `feature`. */
export function EntitlementGate({ feature, children, fallback }: { feature: string; children: ReactNode; fallback?: ReactNode }) {
  const { allowed, isPending, isError, error, refetch } = useFeature(feature);
  if (isPending) return <Skeleton className="h-40 rounded-xl" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!allowed) return fallback ?? <UpgradePrompt />;
  return children;
}

export function UpgradePrompt() {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Lock className="size-4" aria-hidden />
        </div>
        <CardTitle>Not included in your plan</CardTitle>
        <CardDescription>Upgrade to unlock this part of Engora.</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild>
          <Link href="/app/subscription">See plans</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function UsageSummary() {
  const { data, isPending, isError, error, refetch } = useCurrentSubscription();

  if (isPending) return <Skeleton className="h-44 rounded-xl" />;
  if (isError) return <ErrorState title="Couldn't load your plan" error={error} onRetry={() => void refetch()} />;

  const { entitlements } = data;
  const limits = Object.entries(entitlements.limits);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {entitlements.plan_name}
          <Badge variant={entitlements.status === "free" ? "secondary" : "success"}>{entitlements.status}</Badge>
        </CardTitle>
        <CardDescription>Your plan and today&apos;s AI usage</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {limits.length === 0 && <p className="text-sm text-muted-foreground">No metered features on this plan.</p>}
        {limits.map(([key, limit]) => (
          <div key={key} className="grid gap-1.5">
            <div className="flex justify-between gap-4 text-sm">
              <span>{limit.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {limit.limit === null ? "Unlimited" : `${limit.used} / ${limit.limit}`}
              </span>
            </div>
            {limit.limit !== null && <Progress value={usagePercent(limit)} aria-label={`${limit.label} usage`} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PlanList() {
  const plans = usePlans();
  const current = useCurrentSubscription();

  if (plans.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-80 rounded-xl" />
        ))}
      </div>
    );
  }
  if (plans.isError) {
    return <ErrorState title="Couldn't load plans" error={plans.error} onRetry={() => void plans.refetch()} />;
  }

  const currentCode = current.data?.entitlements.plan_code;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {plans.data.map((plan) => {
        const isCurrent = plan.code === currentCode;
        return (
          <Card key={plan.id} className={isCurrent ? "border-primary ring-1 ring-primary" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {plan.name}
                {isCurrent && <Badge>Current</Badge>}
              </CardTitle>
              <CardDescription>{plan.description}</CardDescription>
              <p className="pt-2 text-2xl font-semibold tracking-tight">{formatPlanPrice(plan)}</p>
              {plan.trial_days > 0 && <p className="text-xs text-muted-foreground">{plan.trial_days}-day free trial</p>}
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="grid gap-2 text-sm">
                {plan.entitlements.map((e) => (
                  <li key={e.key} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <span>{describeEntitlement(e)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button className="w-full" variant={isCurrent ? "outline" : "default"} disabled>
                {isCurrent ? "Your plan" : "Available soon"}
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
