"use client";

import type { PlanEntitlement, SubscriptionPlan } from "@engora/types";
import { Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { Messages } from "@/locales/en";
import { cn } from "@/lib/utils";

import { useI18n } from "../i18n";

function describe(e: PlanEntitlement, t: Messages): string {
  const what = t.pricing.entitlements[e.key] ?? e.description;
  if (e.kind === "feature") return what;
  if (e.limit === null) return t.pricing.unlimited(what);
  return t.pricing.limit(e.limit, what, e.period ?? "lifetime");
}

function price(plan: SubscriptionPlan, t: Messages): { amount: string; suffix?: string } {
  if (plan.price_cents === 0) return { amount: t.pricing.free };
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency }).format(plan.price_cents / 100);
  if (plan.billing_interval === "month") return { amount, suffix: t.pricing.perMonth };
  if (plan.billing_interval === "year") return { amount, suffix: t.pricing.perYear };
  return { amount };
}

export function PricingCards({ plans }: { plans: SubscriptionPlan[] | null }) {
  const { t } = useI18n();

  if (!plans || plans.length === 0) {
    return (
      <div className="glass-card grid justify-items-center gap-2 rounded-2xl p-10 text-center">
        <p className="text-h4">{t.pricing.unavailableTitle}</p>
        <p className="text-body-sm text-fg-secondary">{t.pricing.unavailableText}</p>
        <Button className="mt-3" variant="liquid" asChild>
          <Link href="/register">{t.pricing.startFree}</Link>
        </Button>
      </div>
    );
  }

  // The first paid monthly plan is highlighted as the recommended one.
  const highlight = plans.find((p) => !p.is_default && p.billing_interval !== "none")?.code;

  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => {
        const featured = plan.code === highlight;
        const { amount, suffix } = price(plan, t);
        return (
          <article
            key={plan.id}
            className={cn(
              "glass-card glass-hover relative flex flex-col gap-6 rounded-2xl p-6 sm:p-7",
              featured && "border-primary/45 shadow-[inset_0_1px_0_0_var(--glass-highlight),0_24px_60px_-30px_var(--primary-glow)]",
            )}
          >
            {featured && (
              <span aria-hidden className="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
            )}
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-h3">{plan.name}</h3>
                {featured && (
                  <span className="rounded-full bg-primary px-2.5 py-0.5 text-caption font-semibold text-primary-foreground">{t.pricing.mostPopular}</span>
                )}
              </div>
              <p className="min-h-10 text-body-sm text-fg-secondary">{t.pricing.plans[plan.code] ?? plan.description}</p>
            </div>
            <div className="min-h-[4.25rem]">
              <p className="flex items-baseline gap-1.5">
                <span className="text-h1 tabular-nums">{amount}</span>
                {suffix && <span className="text-body-sm text-fg-muted">{suffix}</span>}
              </p>
              <p className="mt-1 h-4 text-caption text-fg-muted">{plan.trial_days > 0 ? t.pricing.trial(plan.trial_days) : ""}</p>
            </div>
            <ul className="grid gap-2.5 border-t border-(--glass-border) pt-5 text-body-sm">
              {plan.entitlements.map((e) => (
                <li key={e.key} className="flex gap-2.5">
                  <Check className={cn("mt-0.5 size-4 shrink-0", featured ? "text-primary" : "text-fg-muted")} aria-hidden />
                  <span className="text-fg-secondary">{describe(e, t)}</span>
                </li>
              ))}
            </ul>
            <Button className="mt-auto h-11 w-full" variant={featured ? "liquid" : "glass"} asChild>
              <Link href="/register">{plan.is_default ? t.pricing.startFree : t.pricing.choose(plan.name)}</Link>
            </Button>
          </article>
        );
      })}
    </div>
  );
}
