"use client";

import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { subscriptionApi } from "./api";
import { hasFeature } from "./lib/entitlements";

export function usePlans() {
  return useQuery({ queryKey: queryKeys.subscription.plans, queryFn: subscriptionApi.plans, staleTime: 10 * 60_000 });
}

export function useCurrentSubscription() {
  const { status } = useSession();
  return useQuery({
    queryKey: queryKeys.subscription.current,
    queryFn: subscriptionApi.current,
    enabled: status === "authenticated",
  });
}

/** Entitlement check for UI decisions. The API enforces the same rule server-side. */
export function useFeature(key: string) {
  const query = useCurrentSubscription();
  return { ...query, allowed: hasFeature(query.data?.entitlements, key) };
}
