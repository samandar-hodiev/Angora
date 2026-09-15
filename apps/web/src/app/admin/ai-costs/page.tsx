import type { Metadata } from "next";

import { AdminAICostsView } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "AI Costs" };

export default function Page() {
  return <AdminAICostsView />;
}
