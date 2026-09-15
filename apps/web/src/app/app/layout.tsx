import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthGuard } from "@/features/auth/components/guards";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
