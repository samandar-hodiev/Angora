"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { FullPageLoader } from "@/components/common/full-page-loader";

import { useSession } from "../hooks";
import { DEFAULT_LANDING_PATH, takePendingRedirect } from "../session";

/** Renders children only for authenticated users; others are sent to /login. */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  if (status !== "authenticated") return <FullPageLoader label="Loading your workspace" />;
  return children;
}

/**
 * Keeps signed-in users out of login/register. After a sign-in on these pages it sends the
 * user where that sign-in asked (onboarding for new accounts, ?next= for returning ones).
 */
export function GuestGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace(takePendingRedirect() ?? DEFAULT_LANDING_PATH);
  }, [status, router]);

  if (status === "authenticated") return <FullPageLoader label="Signing you in" />;
  return children;
}
