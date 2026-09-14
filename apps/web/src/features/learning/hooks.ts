"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";

import { learningApi } from "./api";

const REFERENCE_STALE_TIME = 10 * 60_000;

export function useSkills() {
  return useQuery({ queryKey: queryKeys.learning.skills, queryFn: learningApi.skills, staleTime: REFERENCE_STALE_TIME });
}

export function useLevels() {
  return useQuery({ queryKey: queryKeys.learning.levels, queryFn: learningApi.levels, staleTime: REFERENCE_STALE_TIME });
}
