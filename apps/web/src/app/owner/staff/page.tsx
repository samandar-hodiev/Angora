import type { Metadata } from "next";

import { StaffView } from "@/features/owner/views/staff-view";

export const metadata: Metadata = { title: "Staff" };

export default function OwnerStaffPage() {
  return <StaffView />;
}
