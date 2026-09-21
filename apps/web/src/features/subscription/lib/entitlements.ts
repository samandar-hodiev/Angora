import type { Entitlements, LimitState, PlanEntitlement, SubscriptionPlan } from "@engora/types";

/**
 * Entitlement helpers. UI never checks plan codes ("pro"); it asks whether a feature or
 * limit is present in the entitlements returned by the API.
 */

export function hasFeature(entitlements: Entitlements | undefined, key: string): boolean {
  return entitlements?.features.includes(key) ?? false;
}

export function limitOf(entitlements: Entitlements | undefined, key: string): LimitState | undefined {
  return entitlements?.limits[key];
}

/** 0–100 usage for progress bars; unlimited limits report 0. */
export function usagePercent(limit: LimitState): number {
  if (limit.limit === null || limit.limit === 0) return 0;
  return Math.min(100, Math.round((limit.used / limit.limit) * 100));
}

const periodLabel: Record<string, string> = {
  day: "per day",
  week: "per week",
  month: "per month",
  lifetime: "total",
};

export function describeEntitlement(e: PlanEntitlement): string {
  if (e.kind === "feature") return e.description;
  if (e.limit === null) return `Unlimited ${e.description.toLowerCase()}`;
  return `${e.limit} ${e.description.toLowerCase()} ${periodLabel[e.period ?? "lifetime"] ?? ""}`.trim();
}

/**
 * What this plan costs, in the currency the learner would actually be charged.
 *
 * The so'm price wins when there is one, because that is what the payment provider bills —
 * showing a dollar figure next to a Click button that charges so'm is the kind of small
 * dishonesty people notice at exactly the wrong moment.
 */
export function formatPlanPrice(plan: SubscriptionPlan, locale?: string): string {
  if (plan.price_uzs && plan.price_uzs > 0) {
    return withInterval(plan, `${formatSom(plan.price_uzs)} so'm`);
  }
  if (plan.price_cents === 0) return "Free";
  const amount = new Intl.NumberFormat(locale, { style: "currency", currency: plan.currency }).format(
    plan.price_cents / 100,
  );
  return withInterval(plan, amount);
}

/** Uzbek prices are grouped with spaces, not commas. */
export function formatSom(som: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(som)).replace(/,/g, "\u00a0");
}

/** Minor units (tiyin) to a readable so'm amount. */
export function formatMinor(minor: number, currency: string): string {
  const major = minor / 100;
  if (currency === "UZS") return `${formatSom(major)} so'm`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(major);
}

function withInterval(plan: SubscriptionPlan, amount: string): string {
  if (plan.billing_interval === "month") return `${amount} / month`;
  if (plan.billing_interval === "year") return `${amount} / year`;
  return amount;
}
