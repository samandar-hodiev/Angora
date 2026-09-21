import type { Metadata } from "next";

import { OwnerDashboardView } from "@/features/owner/views/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default function OwnerDashboardPage() {
  return <OwnerDashboardView />;
}
