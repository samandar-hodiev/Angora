"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";

import { platformApi } from "./api";

export function useSiteSettings() {
  return useQuery({
    queryKey: queryKeys.platform.settings,
    queryFn: platformApi.settings,
    // Owner settings change rarely and are read by nearly every page.
    staleTime: 10 * 60_000,
  });
}

/**
 * Whether a platform-wide feature is switched on.
 *
 * This is not access control — the API decides that, per learner, from their plan. It is
 * the owner's switch for whether the product offers something at all, and the default while
 * it is loading is "on", so a slow settings request never makes the app look broken.
 */
export function usePlatformFeature(key: string): boolean {
  const settings = useSiteSettings();
  if (settings.isPending || !settings.data) return true;
  return settings.data.features[key] ?? true;
}
