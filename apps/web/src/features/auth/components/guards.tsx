"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { FullPageLoader } from "@/components/common/full-page-loader";

import { useSession } from "../hooks";
import { DEFAULT_LANDING_PATH, takePendingRedirect } from "../session";

// TEMPORARY: the workspace loader stays up for at least this long, so its background can be
// looked at. Remove once it has been reviewed — set to 0 or delete with the hold below.
const LOADER_PREVIEW_MS = 5000;

/** Renders children only for authenticated users; others are sent to /login. */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [held, setHeld] = useState(LOADER_PREVIEW_MS > 0);
  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(false), LOADER_PREVIEW_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  if (status !== "authenticated" || held) return <FullPageLoader label="Loading your workspace" />;
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
