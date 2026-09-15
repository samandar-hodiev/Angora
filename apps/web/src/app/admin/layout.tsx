import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/features/admin/admin-shell";
import { AuthGuard } from "@/features/auth/components/guards";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Engora Admin" }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AdminShell>{children}</AdminShell>
    </AuthGuard>
  );
}
