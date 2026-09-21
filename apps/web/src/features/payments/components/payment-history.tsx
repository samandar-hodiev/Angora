"use client";

import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMinor } from "@/features/subscription/lib/entitlements";

import { usePaymentHistory } from "../hooks";

/**
 * What this learner has paid.
 *
 * Every attempt is listed, not only the successful ones: somebody whose card was declined
 * needs to see that it was declined, and support needs to see the same thing they do.
 */

const tone = {
  paid: "success",
  prepared: "outline",
  created: "secondary",
  canceled: "secondary",
  failed: "destructive",
} as const;

const label = {
  paid: "Paid",
  prepared: "Waiting for confirmation",
  created: "Started",
  canceled: "Cancelled",
  failed: "Failed",
} as const;

export function PaymentHistory() {
  const payments = usePaymentHistory();

  if (payments.isPending) return <Skeleton className="h-32 rounded-xl" />;
  if (payments.isError) {
    return <ErrorState title="Couldn't load your payments" error={payments.error} onRetry={() => void payments.refetch()} />;
  }
  if (payments.data.length === 0) {
    return <EmptyState title="No payments yet" description="Anything you pay for will be listed here." className="py-8" />;
  }

  return (
    <ul className="grid gap-2">
      {payments.data.map((payment) => (
        <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface p-4">
          <div className="grid min-w-0 gap-0.5">
            <p className="truncate text-body-sm font-medium">{payment.plan_name}</p>
            <p className="text-caption text-fg-muted">
              {new Date(payment.created_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {payment.error_note ? ` · ${payment.error_note}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="tabular-nums">{formatMinor(payment.amount_minor, payment.currency)}</span>
            <Badge variant={tone[payment.status]}>{label[payment.status]}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
