"use client";

import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { learningApi, type ContentFilters } from "./api";

const REFERENCE_STALE_TIME = 10 * 60_000;

export function useSkills() {
  return useQuery({ queryKey: queryKeys.learning.skills, queryFn: learningApi.skills, staleTime: REFERENCE_STALE_TIME });
}

export function useLevels() {
  return useQuery({ queryKey: queryKeys.learning.levels, queryFn: learningApi.levels, staleTime: REFERENCE_STALE_TIME });
}

/** Published content for learners, e.g. { type: "speaking_topic", level: "B1" }. */
export function useContentList(filters: ContentFilters) {
  const { status } = useSession();
  return useQuery({
    queryKey: queryKeys.learning.content({ ...filters }),
    queryFn: () => learningApi.content(filters),
    enabled: status === "authenticated",
    staleTime: 5 * 60_000,
  });
}

export function useContentItem<Body>(id: string | undefined) {
  const { status } = useSession();
  return useQuery({
    queryKey: queryKeys.learning.contentItem(id ?? ""),
    queryFn: () => learningApi.contentItem<Body>(id!),
    enabled: status === "authenticated" && Boolean(id),
    staleTime: 5 * 60_000,
  });
}
