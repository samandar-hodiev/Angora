import type { Metadata } from "next";

import { AdminPlaceholder } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "Revenue" };

export default function Page() {
  return <AdminPlaceholder title="Revenue" description="Revenue, refunds and churn reporting arrive with payments." />;
}
