"use client";

/**
 * Data hooks for the Owner console.
 *
 * Components never import the service layer directly: they call these hooks, which own the
 * cache keys and the invalidation. When the mock services become HTTP calls, only
 * ./services/index.ts changes — every hook and every component below stays as it is.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";

import * as ownerApi from "./services";
import type { GrammarQuery } from "./services";
import type {
  ContentLanguage,
  ContentQuery,
  ContentStatus,
  FeatureAccess,
  LearnerQuery,
  LearnerStatus,
  PlanCode,
  PlanFilter,
  RangeKey,
  SiteSettings,
} from "./types";

const STALE = 60_000;

export function useDashboardMetrics(plan: PlanFilter) {
  return useQuery({
    queryKey: queryKeys.owner.dashboard(plan),
    queryFn: () => ownerApi.getDashboardMetrics(plan),
    placeholderData: keepPreviousData,
    staleTime: STALE,
  });
}

export function useLearnerGrowth(range: RangeKey) {
  return useQuery({
    queryKey: queryKeys.owner.growth(range),
    queryFn: () => ownerApi.getLearnerGrowth(range),
    placeholderData: keepPreviousData,
    staleTime: STALE,
  });
}

export function usePlanDistribution() {
  return useQuery({ queryKey: queryKeys.owner.planDistribution, queryFn: ownerApi.getPlanDistribution, staleTime: STALE });
}

export function useActivitySummary() {
  return useQuery({ queryKey: queryKeys.owner.activitySummary, queryFn: ownerApi.getActivitySummary, staleTime: STALE });
}

export function useConversionSummary() {
  return useQuery({ queryKey: queryKeys.owner.conversions, queryFn: ownerApi.getConversionSummary, staleTime: STALE });
}

export function useRecentLearners(limit = 6) {
  return useQuery({ queryKey: queryKeys.owner.recentLearners, queryFn: () => ownerApi.getRecentLearners(limit), staleTime: STALE });
}

export function useRecentConversions(limit = 6) {
  return useQuery({
    queryKey: queryKeys.owner.recentConversions,
    queryFn: () => ownerApi.getRecentConversions(limit),
    staleTime: STALE,
  });
}

export function useContentStats() {
  return useQuery({ queryKey: queryKeys.owner.contentStats, queryFn: ownerApi.getContentStats, staleTime: STALE });
}

export function useActivityFeed(limit = 8) {
  return useQuery({ queryKey: queryKeys.owner.activityFeed, queryFn: () => ownerApi.getActivityFeed(limit), staleTime: STALE });
}

export function useHealthChecks() {
  return useQuery({ queryKey: queryKeys.owner.health, queryFn: ownerApi.getHealthChecks, staleTime: STALE });
}

// ---- Content ---------------------------------------------------------------------------------

export function useContent(query: ContentQuery) {
  return useQuery({
    queryKey: queryKeys.owner.content(query as Record<string, string | number | undefined>),
    queryFn: () => ownerApi.getContent(query),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateContentStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ContentStatus }) => ownerApi.updateContentStatus(id, status),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

// ---- Grammar ---------------------------------------------------------------------------------

export function useGrammarCategories() {
  return useQuery({ queryKey: queryKeys.owner.grammarCategories, queryFn: ownerApi.getGrammarCategories, staleTime: STALE });
}

export function useGrammarTopics(query: GrammarQuery) {
  return useQuery({
    queryKey: queryKeys.owner.grammarTopics(query as Record<string, string | number | undefined>),
    queryFn: () => ownerApi.getGrammarTopics(query),
    placeholderData: keepPreviousData,
  });
}

export function useGrammarTopic(slug: string) {
  return useQuery({
    queryKey: queryKeys.owner.grammarTopic(slug),
    queryFn: () => ownerApi.getGrammarTopic(slug),
    enabled: Boolean(slug),
  });
}

export function useSaveGrammarSection(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof ownerApi.saveGrammarSection>[0], "slug">) =>
      ownerApi.saveGrammarSection({ ...input, slug }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useSetGrammarStatus(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (status: ContentStatus) => ownerApi.setGrammarStatus(slug, status),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useCreateGrammarTopic() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ownerApi.createGrammarTopic,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

// ---- Paywall ---------------------------------------------------------------------------------

export function useFeatureAccess() {
  return useQuery({ queryKey: queryKeys.owner.features, queryFn: ownerApi.getFeatureAccess, staleTime: STALE });
}

export function useUpdateFeatureAccess() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: Partial<FeatureAccess> }) => ownerApi.updateFeatureAccess(key, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.features }),
  });
}

// ---- Settings --------------------------------------------------------------------------------

export function useSiteSettings() {
  return useQuery({ queryKey: queryKeys.owner.settings, queryFn: ownerApi.getSiteSettings, staleTime: STALE });
}

export function useUpdateSiteSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SiteSettings>) => ownerApi.updateSiteSettings(patch),
    onSuccess: (settings) => client.setQueryData(queryKeys.owner.settings, settings),
  });
}

export function useWallpapers() {
  return useQuery({ queryKey: queryKeys.owner.wallpapers, queryFn: ownerApi.getWallpapers, staleTime: STALE });
}

export function useSetWallpaperEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => ownerApi.setWallpaperEnabled(id, enabled),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.wallpapers }),
  });
}

export function useMoveWallpaper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: "up" | "down" }) => ownerApi.moveWallpaper(id, direction),
    onSuccess: (wallpapers) => client.setQueryData(queryKeys.owner.wallpapers, wallpapers),
  });
}

// ---- Learners --------------------------------------------------------------------------------

export function useLearners(query: LearnerQuery) {
  return useQuery({
    queryKey: queryKeys.owner.learners(query as Record<string, string | number | undefined>),
    queryFn: () => ownerApi.getLearners(query),
    placeholderData: keepPreviousData,
  });
}

export function useLearner(id: string) {
  return useQuery({ queryKey: queryKeys.owner.learner(id), queryFn: () => ownerApi.getLearner(id), enabled: Boolean(id) });
}

export function useUpdateLearnerPlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: PlanCode }) => ownerApi.updateLearnerPlan(id, plan),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useUpdateLearnerStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: LearnerStatus }) => ownerApi.updateLearnerStatus(id, status),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

/**
 * Mock AI generation. Reports each step so the dialog can show what is being written; the
 * real version will stream the same steps from the API instead of a timer.
 */
export function useGenerateGrammarContent(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      languages?: ContentLanguage[];
      onStep?: (step: { key: string; label: string; index: number; total: number }) => void;
    }) =>
      ownerApi.generateGrammarContent({ slug, ...input }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}
