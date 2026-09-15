import type { SubscriptionPlan } from "@engora/types";

import { PricingCards } from "./pricing-cards";

/** Server-side fetch of public plans; prices and entitlements always come from the API. */
export async function fetchPublicPlans(): Promise<SubscriptionPlan[] | null> {
  const base = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/v1/subscriptions/plans`, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const envelope = (await res.json()) as { success: boolean; data?: SubscriptionPlan[] };
    return envelope.success && envelope.data ? envelope.data : null;
  } catch {
    return null;
  }
}

export async function PricingPlans() {
  const plans = await fetchPublicPlans();
  return <PricingCards plans={plans} />;
}
