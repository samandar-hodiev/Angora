import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthGuard } from "@/features/auth/components/guards";

export const metadata: Metadata = { title: "Set up your plan", robots: { index: false, follow: false } };

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
