import type { Metadata } from "next";

import { AdminPlaceholder } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "Support" };

export default function Page() {
  return <AdminPlaceholder title="Support" description="Learner support tickets and account tools will live here." />;
}
