import type { Metadata } from "next";

import { AdminAIUsageView } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "AI Usage" };

export default function Page() {
  return <AdminAIUsageView />;
}
