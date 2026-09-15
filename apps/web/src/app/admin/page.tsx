import type { Metadata } from "next";

import { AdminOverviewView } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "Overview" };

export default function AdminPage() {
  return <AdminOverviewView />;
}
