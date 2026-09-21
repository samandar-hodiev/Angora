import type { Metadata } from "next";

import { OwnerAnalyticsView } from "@/features/owner/views/analytics-view";

export const metadata: Metadata = { title: "Analytics" };

export default function OwnerAnalyticsPage() {
  return <OwnerAnalyticsView />;
}
