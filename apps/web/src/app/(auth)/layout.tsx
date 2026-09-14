import type { ReactNode } from "react";

import { Brand } from "@/components/common/brand";
import { GuestGuard } from "@/features/auth/components/guards";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <GuestGuard>
      <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
        <Brand className="mb-8 text-lg" />
        <main id="main" className="w-full max-w-sm">
          {children}
        </main>
      </div>
    </GuestGuard>
  );
}
