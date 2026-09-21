import type { Metadata } from "next";

import { OwnerPaymentsView } from "@/features/owner/views/payments-view";

export const metadata: Metadata = { title: "Payments" };

export default function OwnerPaymentsPage() {
  return <OwnerPaymentsView />;
}
