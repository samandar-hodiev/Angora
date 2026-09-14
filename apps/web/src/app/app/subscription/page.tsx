import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PlanList, UsageSummary } from "@/features/subscription/components/subscription-views";

export const metadata: Metadata = { title: "Subscription" };

export default function SubscriptionPage() {
  return (
    <div className="grid gap-8">
      <div>
        <PageHeader title="Subscription" description="Plans and limits come from your account, on every device." />
        <div className="max-w-xl">
          <UsageSummary />
        </div>
      </div>
      <section aria-labelledby="plans-title" className="grid gap-4">
        <h2 id="plans-title" className="text-lg font-semibold tracking-tight">
          Plans
        </h2>
        <PlanList />
      </section>
    </div>
  );
}
