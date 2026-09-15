import type { ReactNode } from "react";

import { Brand } from "@/components/common/brand";
import { GuestGuard } from "@/features/auth/components/guards";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <GuestGuard>
      <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
        <Brand className="mb-8" />
        <main id="main" className="w-full max-w-[400px]">
          {children}
        </main>
      </div>
    </GuestGuard>
  );
}
