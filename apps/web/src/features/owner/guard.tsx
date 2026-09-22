"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { EmptyState } from "@/components/common/states";
import { FullPageLoader } from "@/components/common/full-page-loader";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/hooks";

/**
 * Who may open the console.
 *
 * The API decides — every /admin endpoint checks its own permission and a session with the
 * wrong role gets nothing but 403s. What happens here is only about which screen to show:
 * sending someone to the sign-in page instead of a console full of empty error states.
 *
 * OWNER is the one role that can manage staff. Everything else on this list runs the
 * platform in some narrower way, and the pages they cannot use refuse them individually.
 */

export const CONSOLE_ROLES = ["OWNER", "ADMIN", "CONTENT_MANAGER", "SUPPORT", "ANALYST"];

export function useConsoleAccess(): boolean {
  const role = useSession().user?.role;
  return role !== undefined && CONSOLE_ROLES.includes(role);
}

/** True only for the platform owner. The staff list is the one thing this gates. */
export function useIsPlatformOwner(): boolean {
  return useSession().user?.role === "OWNER";
}

/**
 * A build can open the console without a session for local work on the layout, but only when
 * somebody sets the flag on purpose. It used to be on for every development build, which
 * meant the guard was never actually exercised until production — the one place you do not
 * want to find out it was wrong.
 */
export const ownerPreviewMode = process.env.NEXT_PUBLIC_OWNER_PREVIEW === "1";

export function OwnerGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const allowed = useConsoleAccess();
  const router = useRouter();

  const anonymous = status === "anonymous" && !ownerPreviewMode;
  useEffect(() => {
    if (anonymous) router.replace("/owner/login");
  }, [anonymous, router]);

  if (ownerPreviewMode) return children;
  if (status === "loading" || anonymous) return <FullPageLoader label="Checking your access" />;
  if (!allowed) {
    return (
      <main id="main" className="mx-auto max-w-lg px-4 py-24">
        <EmptyState
          icon={ShieldAlert}
          title="This console is not for this account"
          description="Access to the Owner Console is granted by the owner. Your account does not have it."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/app/dashboard">Back to the app</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/owner/login">Sign in to the console</Link>
              </Button>
            </div>
          }
        />
      </main>
    );
  }
  return children;
}
