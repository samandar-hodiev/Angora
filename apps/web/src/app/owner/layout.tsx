import type { Metadata } from "next";
import type { ReactNode } from "react";

import { OwnerShell } from "@/features/owner/components/shell";
import { OwnerGuard } from "@/features/owner/guard";

export const metadata: Metadata = {
  title: { default: "Owner", template: "%s · Engora Owner" },
  robots: { index: false, follow: false },
};

/**
 * The Owner console is a separate application area: its own layout, its own navigation and its
 * own data layer. It never renders learner navigation, and the learner app never links into it.
 */
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <OwnerGuard>
      <OwnerShell>{children}</OwnerShell>
    </OwnerGuard>
  );
}
