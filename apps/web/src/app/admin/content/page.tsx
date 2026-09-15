import type { Metadata } from "next";

import { AdminContentView } from "@/features/admin/admin-views";

export const metadata: Metadata = { title: "Content" };

export default function Page() {
  return <AdminContentView />;
}
