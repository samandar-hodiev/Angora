import type { Metadata } from "next";

import { AdminSystemView } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "System" };

export default function Page() {
  return <AdminSystemView />;
}
