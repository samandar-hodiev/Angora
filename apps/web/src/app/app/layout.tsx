import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthGuard } from "@/features/auth/components/guards";
import { JourneyGuard } from "@/features/onboarding/components/journey-guard";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Signed-in area. Learners who have not finished setup are sent back to where they stopped. */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <JourneyGuard>{children}</JourneyGuard>
    </AuthGuard>
  );
}
