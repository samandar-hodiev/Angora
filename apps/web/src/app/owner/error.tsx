"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/common/states";

/** Anything that throws inside the owner console lands here instead of a blank screen. */
export default function OwnerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-lg py-16">
      <ErrorState
        error={error}
        title="This page could not be rendered"
        description="Something in the owner console failed. Try again, or go back to the dashboard."
        onRetry={reset}
      />
      <div className="mt-4 flex justify-center">
        <Button variant="outline" size="sm" onClick={() => router.push("/owner/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
