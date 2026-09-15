import type { ReactNode } from "react";

import { JourneyShell } from "@/components/journey/journey-shell";
import { GuestGuard } from "@/features/auth/components/guards";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <GuestGuard>
      <JourneyShell>{children}</JourneyShell>
    </GuestGuard>
  );
}
