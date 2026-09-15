import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthGuard } from "@/features/auth/components/guards";
import { JourneyGuard } from "@/features/onboarding/components/journey-guard";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Profile setup, onboarding, level selection, placement test and results: signed-in, in order. */
export default function JourneyLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <JourneyGuard>{children}</JourneyGuard>
    </AuthGuard>
  );
}
