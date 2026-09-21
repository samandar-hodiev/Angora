import type { Metadata } from "next";

import { OwnerAuditView } from "@/features/owner/views/audit-view";

export const metadata: Metadata = { title: "Audit log" };

export default function OwnerAuditPage() {
  return <OwnerAuditView />;
}
