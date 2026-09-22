"use client";

import { KeyRound, ServerCrash, ShieldOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api";

/**
 * Failure states for the parts of the console that read the real API.
 *
 * The console can be opened in development without signing in, so "no data" here is usually
 * "no owner session" rather than a bug. Saying which one it is — instead of showing a generic
 * error — is the difference between a dead screen and an obvious next step.
 */
export function LiveDataState({ error, onRetry }: { error: unknown; onRetry?: () => void }): ReactNode {
  if (isApiError(error) && (error.code === "UNAUTHORIZED" || error.status === 401)) {
    return (
      <EmptyState
        icon={KeyRound}
        title="Sign in to load live data"
        description="This page reads the platform database directly. Sign in with an account that holds the owner role."
        action={
          <Button asChild size="sm">
            <Link href="/login?next=/owner/dashboard">Sign in</Link>
          </Button>
        }
      />
    );
  }

  // The API says exactly what it refused, so show that rather than a guess. This used to
  // read "cannot manage assessments" everywhere, which was true on one page and misleading
  // on the other fifteen.
  if (isApiError(error) && (error.code === "FORBIDDEN" || error.status === 403)) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Your account does not have access to this"
        description={`${error.message} The console is open in development, but the API still checks permissions — an account needs the owner role to read platform data.`}
      />
    );
  }

  if (isApiError(error) && error.code === "NETWORK_ERROR") {
    return (
      <ErrorState
        title="The API is not reachable"
        description="Start the Go API (make api, or docker compose up) and try again."
        onRetry={onRetry}
      />
    );
  }

  return <ErrorState error={error} title="This could not be loaded" onRetry={onRetry} />;
}

export function ServiceUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      error={undefined}
      title="Service unavailable"
      description="The API responded with an error. Check the server logs."
      onRetry={onRetry}
    />
  );
}

export const liveStateIcons = { ServerCrash };
