"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { FullPageLoader } from "@/components/common/full-page-loader";
import { ErrorState } from "@/components/common/states";
import { OWNER_LANDING_PATH } from "@/features/auth/session";
import { useConsoleAccess } from "@/features/owner/guard";

import { useOnboarding } from "../hooks";
import { isJourneyPathAllowed, journeyPath } from "../routing";

/**
 * Keeps a signed-in learner on the step the server says is current: profile setup, then
 * onboarding, level, placement test, results, and finally the app. Closing the browser at any
 * point and signing in again resumes exactly there.
 *
 * The owner and staff have no learner journey — they run the platform from the console — so
 * they are sent there rather than asked to set up a learner profile.
 */
export function JourneyGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const staff = useConsoleAccess();
  const onboarding = useOnboarding();
  const { data: state, dataUpdatedAt, refetch } = onboarding;
  const allowed = state ? isJourneyPathAllowed(state, pathname) : false;
  const target = state ? journeyPath(state) : null;
  const refetchRequestedAt = useRef(0);

  useEffect(() => {
    if (staff) {
      router.replace(OWNER_LANDING_PATH);
      return;
    }
    if (!target || allowed) return;
    // Waiting for the fresh state requested below.
    if (dataUpdatedAt <= refetchRequestedAt.current) return;
    // The cached state may be behind the server (e.g. a background evaluation just finished):
    // confirm with the server before sending the learner somewhere else.
    if (Date.now() - dataUpdatedAt > 1000) {
      refetchRequestedAt.current = Date.now();
      void refetch();
      return;
    }
    router.replace(target);
  }, [staff, allowed, target, dataUpdatedAt, refetch, router]);

  if (staff) return <FullPageLoader label="Opening the Owner Console" />;
  if (onboarding.isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <ErrorState error={onboarding.error} onRetry={() => void onboarding.refetch()} className="max-w-md" />
      </div>
    );
  }
  if (!state || !allowed) return <FullPageLoader label="Loading your journey" />;
  return children;
}
