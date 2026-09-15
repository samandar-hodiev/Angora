import type { Metadata } from "next";

import { AdminPlaceholder } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return <AdminPlaceholder title="Reports" description="Scheduled business and learning reports will live here." />;
}
