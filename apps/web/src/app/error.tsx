"use client";

import { ErrorState } from "@/components/common/states";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4">
      <ErrorState
        title="Something went wrong"
        error={new Error("An unexpected error occurred. Please try again.")}
        onRetry={reset}
        className="max-w-md"
      />
    </main>
  );
}
