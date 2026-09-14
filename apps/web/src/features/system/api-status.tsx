"use client";

import type { HealthReport } from "@engora/types";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";

const getHealth = () => apiClient.get<HealthReport>("/health", { auth: false });

/** Small status indicator proving the web client reaches /api/v1. */
export function ApiStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.system.health,
    queryFn: getHealth,
    retry: false,
    refetchInterval: 60_000,
  });

  const state = isPending ? "checking" : isError || data?.status !== "ok" ? "degraded" : "operational";
  const label = { checking: "Checking API…", degraded: "API unavailable", operational: "All systems operational" }[state];

  return (
    <span role="status" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "operational" && "bg-success",
          state === "degraded" && "bg-destructive",
          state === "checking" && "animate-pulse bg-muted-foreground",
        )}
      />
      {label}
    </span>
  );
}
