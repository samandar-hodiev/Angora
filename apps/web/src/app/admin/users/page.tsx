import type { Metadata } from "next";

import { AdminUsersView } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "Users" };

export default function Page() {
  return <AdminUsersView />;
}
