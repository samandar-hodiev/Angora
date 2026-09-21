import type { Metadata } from "next";

import { PaywallView } from "@/features/owner/views/paywall-view";

export const metadata: Metadata = { title: "Paywall" };

export default function OwnerPaywallPage() {
  return <PaywallView />;
}
