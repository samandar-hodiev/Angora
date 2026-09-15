import type { Metadata } from "next";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { CurrentPlan, PlanList } from "@/features/subscription/components/subscription-views";

export const metadata: Metadata = { title: "Subscription" };

export default function SubscriptionPage() {
  return (
    <>
      <PageHeader title="Subscription" description="Your plan and limits come from your account, on every device." />
      <CurrentPlan />
      <section aria-labelledby="plans-title" className="mt-10">
        <SectionTitle id="plans-title" title="Plans" />
        <PlanList />
      </section>
    </>
  );
}
