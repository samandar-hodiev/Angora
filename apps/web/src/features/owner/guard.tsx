"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/common/states";
import { FullPageLoader } from "@/components/common/full-page-loader";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/hooks";

/**
 * Owner authorization.
 *
 * The console is laid out as if the API already enforced `role = OWNER`, because it will:
 * every /owner route is expected to sit behind that check server-side, and the UI here is a
 * convenience, never the control. Frontend gating is not security and is not treated as such.
 *
 * Until the backend grows the role and the /api/v1/owner endpoints, the console runs on the
 * mock service layer and is reachable in development (or with NEXT_PUBLIC_OWNER_PREVIEW=1) so
 * the UI can be built and reviewed. In a production build without that flag it falls back to
 * the real session check below.
 */

export const OWNER_ROLES = ["OWNER", "ADMIN"];

/** UI hint only. TODO(api): replace with the entitlement the /api/v1/owner endpoints return. */
export function useIsOwner(): boolean {
  const role = useSession().user?.role;
  return role !== undefined && OWNER_ROLES.includes(role);
}

export const ownerPreviewMode =
  process.env.NEXT_PUBLIC_OWNER_PREVIEW === "1" || process.env.NODE_ENV !== "production";

export function OwnerGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const isOwner = useIsOwner();

  if (ownerPreviewMode) return children;
  if (status === "loading") return <FullPageLoader label="Checking your access" />;
  if (!isOwner) {
    return (
      <main id="main" className="mx-auto max-w-lg px-4 py-24">
        <EmptyState
          icon={ShieldAlert}
          title="Owner access only"
          description="This console manages the whole platform. Your account doesn't have the owner role."
          action={
            <Button asChild>
              <Link href="/app/dashboard">Back to the app</Link>
            </Button>
          }
        />
      </main>
    );
  }
  return children;
}
