import type { Metadata } from "next";

import { AdminSubscriptionsView } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "Subscriptions" };

export default function Page() {
  return <AdminSubscriptionsView />;
}
