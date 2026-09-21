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
import * as assessmentApi from "./services/assessments";
import type { GrammarQuery } from "./services";
import type {
  ContentLanguage,
  ContentQuery,
  QuestionInput,
  QuestionQuery,
  QuestionStatus,
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

// ---- Assessment & question bank (live API) --------------------------------------------------

/**
 * These hooks talk to the real Go API rather than the mock layer. They keep the same shape as
 * the mock-backed hooks above, so a page does not know or care which side it is reading — and
 * as later phases replace mocks with endpoints, only the service import changes.
 */

export function useQuestions(query: QuestionQuery) {
  return useQuery({
    queryKey: queryKeys.owner.questions(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.getQuestions(query),
    placeholderData: keepPreviousData,
  });
}

export function useQuestion(id: string | null) {
  return useQuery({
    queryKey: queryKeys.owner.question(id ?? ""),
    queryFn: () => assessmentApi.getQuestion(id!),
    enabled: Boolean(id),
  });
}

export function useQuestionStats() {
  return useQuery({ queryKey: queryKeys.owner.questionStats, queryFn: assessmentApi.getQuestionStats });
}

export function useCreateQuestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: QuestionInput) => assessmentApi.createQuestion(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useUpdateQuestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuestionInput }) => assessmentApi.updateQuestion(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useSetQuestionStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuestionStatus }) => assessmentApi.setQuestionStatus(id, status),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useAssessmentConfigs() {
  return useQuery({ queryKey: queryKeys.owner.assessmentConfigs, queryFn: assessmentApi.getAssessmentConfigs });
}

export function useActivateAssessmentConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assessmentApi.activateAssessmentConfig(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.assessmentConfigs }),
  });
}

export function useAssessmentAttempts(query: { status?: string; level?: string; days?: number; page?: number }) {
  return useQuery({
    queryKey: queryKeys.owner.assessmentAttempts(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.getAssessmentAttempts(query),
    placeholderData: keepPreviousData,
  });
}

export function useAssessmentStats(days: number) {
  return useQuery({
    queryKey: queryKeys.owner.assessmentStats(days),
    queryFn: () => assessmentApi.getAssessmentStats(days),
    placeholderData: keepPreviousData,
  });
}

// ---- Plans, entitlements and audit (live API) -------------------------------------------------

export function usePlans() {
  return useQuery({ queryKey: queryKeys.owner.plans, queryFn: assessmentApi.getPlans });
}

export function useEntitlements() {
  return useQuery({ queryKey: queryKeys.owner.entitlements, queryFn: assessmentApi.getEntitlements });
}

export function useSetPlanEntitlement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: assessmentApi.setPlanEntitlement,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useRevokePlanEntitlement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, key }: { planId: string; key: string }) => assessmentApi.revokePlanEntitlement(planId, key),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useAuditLogs(query: { action?: string; entity?: string; days?: number; page?: number }) {
  return useQuery({
    queryKey: queryKeys.owner.auditLogs(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.getAuditLogs(query),
    placeholderData: keepPreviousData,
  });
}
