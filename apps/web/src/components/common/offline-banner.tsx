"use client";

import { WifiOff } from "lucide-react";

import { useOnlineStatus } from "@/hooks/use-online-status";

/** Shown when the browser reports no connection. */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-body-sm text-warning-foreground dark:text-warning">
      <WifiOff className="size-4" aria-hidden />
      You&apos;re offline. Your progress is safe and will sync when you reconnect.
    </div>
  );
}
