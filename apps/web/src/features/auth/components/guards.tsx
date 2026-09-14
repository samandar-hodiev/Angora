"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { FullPageLoader } from "@/components/common/full-page-loader";

import { useSession } from "../hooks";

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

/** Keeps signed-in users out of login/register. */
export function GuestGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/app/dashboard");
  }, [status, router]);

  if (status === "authenticated") return <FullPageLoader label="Signing you in" />;
  return children;
}
