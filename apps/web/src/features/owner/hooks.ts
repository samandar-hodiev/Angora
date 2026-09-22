"use client";

/**
 * Data hooks for the Owner console.
 *
 * Components never call the API directly: they use these hooks, which own the cache keys and
 * the invalidation. Everything here reads the platform database through the Go API — the
 * console has no data of its own.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";

import * as assessmentApi from "./services/assessments";
import type { ContentLanguage, QuestionInput, QuestionQuery, QuestionStatus } from "./types";

// ---- Assessment & question bank (live API) --------------------------------------------------

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

export function useCreateAssessmentConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: string; config: unknown }) => assessmentApi.createAssessmentConfig(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.assessmentConfigs }),
  });
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

// ---- Learners, analytics and AI monitoring (live API) -----------------------------------------

export function useLiveLearners(query: { search?: string; plan?: string; level?: string; status?: string; sort?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.owner.liveLearners(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.getLiveLearners(query),
    placeholderData: keepPreviousData,
  });
}

export function useLiveLearner(id: string) {
  return useQuery({
    queryKey: queryKeys.owner.liveLearner(id),
    queryFn: () => assessmentApi.getLiveLearner(id),
    enabled: Boolean(id),
  });
}

export function useSetLearnerStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: "active" | "suspended"; reason?: string }) =>
      assessmentApi.setLearnerStatus(id, status, reason),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useSetUserRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => assessmentApi.setUserRole(id, role),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useRoles() {
  return useQuery({ queryKey: queryKeys.owner.roles, queryFn: assessmentApi.getRoles, staleTime: 10 * 60_000 });
}

export function useAnalyticsOverview(days: number) {
  return useQuery({
    queryKey: queryKeys.owner.analytics(days),
    queryFn: () => assessmentApi.getAnalyticsOverview(days),
    placeholderData: keepPreviousData,
  });
}

export function useGrowthSeries(days: number) {
  return useQuery({
    queryKey: queryKeys.owner.growthSeries(days),
    queryFn: () => assessmentApi.getGrowth(days),
    placeholderData: keepPreviousData,
  });
}

export function useAIFailures(days: number, page: number) {
  return useQuery({
    queryKey: queryKeys.owner.aiFailures(days, page),
    queryFn: () => assessmentApi.getAIFailures(days, page),
    placeholderData: keepPreviousData,
  });
}

export function useAIQuality(days: number) {
  return useQuery({ queryKey: queryKeys.owner.aiQuality(days), queryFn: () => assessmentApi.getAIQuality(days) });
}

export function useAIUsage(days: number) {
  return useQuery({
    queryKey: queryKeys.owner.aiUsage(days),
    queryFn: () => assessmentApi.getAIUsage(days),
    placeholderData: keepPreviousData,
  });
}

// ---- Content, grammar authoring and settings (live API) --------------------------------------

export function useLiveContent(query: { search?: string; type?: string; skill?: string; level?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.owner.liveContent(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.getLiveContent(query),
    placeholderData: keepPreviousData,
  });
}

export function useContentDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.owner.contentDetail(id ?? ""),
    queryFn: () => assessmentApi.contentApi.detail(id!),
    enabled: Boolean(id),
  });
}

export function useContentTaxonomy() {
  return useQuery({
    queryKey: queryKeys.owner.contentTaxonomy,
    queryFn: assessmentApi.contentApi.taxonomy,
    staleTime: 10 * 60_000,
  });
}

export function useSaveContent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Record<string, unknown> }) =>
      id ? assessmentApi.contentApi.update(id, input) : assessmentApi.contentApi.create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useSetContentStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => assessmentApi.contentApi.setStatus(id, status),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useGrammarAdminCategories() {
  return useQuery({ queryKey: queryKeys.owner.grammarAdminCategories, queryFn: assessmentApi.grammarAdminApi.categories });
}

export function useGrammarAdminTopics(query: { search?: string; category?: string; level?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.owner.grammarAdminTopics(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.grammarAdminApi.topics(query),
    placeholderData: keepPreviousData,
  });
}

export function useGrammarAdminTopic(slug: string | null, language: ContentLanguage = "en") {
  return useQuery({
    queryKey: [...queryKeys.owner.grammarAdminTopic(slug ?? ""), language],
    queryFn: () => assessmentApi.grammarAdminApi.topic(slug!, language),
    enabled: Boolean(slug),
  });
}

export function useCreateGrammarTopicLive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: assessmentApi.grammarAdminApi.create,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useSaveGrammarTopic() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: Record<string, unknown> }) =>
      assessmentApi.grammarAdminApi.update(slug, input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useSetGrammarTopicStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: string }) =>
      assessmentApi.grammarAdminApi.setStatus(slug, status),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

export function useLiveSiteSettings() {
  return useQuery({ queryKey: queryKeys.owner.siteSettings, queryFn: assessmentApi.settingsApi.get });
}

export function useUpdateLiveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: assessmentApi.settingsApi.update,
    onSuccess: (settings) => client.setQueryData(queryKeys.owner.siteSettings, settings),
  });
}

export function useLiveWallpapers() {
  return useQuery({ queryKey: queryKeys.owner.liveWallpapers, queryFn: assessmentApi.settingsApi.wallpapers });
}

export function useUpdateWallpaper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { enabled?: boolean; sort_order?: number } }) =>
      assessmentApi.settingsApi.updateWallpaper(id, input),
    onSuccess: (wallpapers) => client.setQueryData(queryKeys.owner.liveWallpapers, wallpapers),
  });
}

// ---- Payments (live API) ----------------------------------------------------------------------

export function usePayments(query: { status?: string; provider?: string; q?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.owner.payments(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.getPayments(query),
    placeholderData: keepPreviousData,
  });
}

export function useRevenue(days: number) {
  return useQuery({
    queryKey: queryKeys.owner.revenue(days),
    queryFn: () => assessmentApi.getRevenue(days),
    placeholderData: keepPreviousData,
  });
}

export function useUpdatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) => assessmentApi.updatePlan(id, input),
    onSuccess: (plans) => {
      client.setQueryData(queryKeys.owner.plans, plans);
      client.invalidateQueries({ queryKey: queryKeys.owner.revenue(30) });
    },
  });
}

// ---- Notification templates (live API) ---------------------------------------------------------

export function useNotificationTemplates() {
  return useQuery({
    queryKey: queryKeys.owner.notificationTemplates,
    queryFn: assessmentApi.notificationsAdminApi.templates,
  });
}

export function useUpdateNotificationTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ code, locale, input }: { code: string; locale: string; input: Record<string, unknown> }) =>
      assessmentApi.notificationsAdminApi.update(code, locale, input),
    onSuccess: (templates) => client.setQueryData(queryKeys.owner.notificationTemplates, templates),
  });
}

export function usePreviewNotificationTemplate() {
  return useMutation({
    mutationFn: ({ code, locale, input }: { code: string; locale: string; input: { subject?: string; body?: string } }) =>
      assessmentApi.notificationsAdminApi.preview(code, locale, input),
  });
}

export function useSentNotifications(query: { code?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.owner.sentNotifications(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.notificationsAdminApi.sent(query),
    placeholderData: keepPreviousData,
  });
}

// ---- Content revisions (live API) --------------------------------------------------------------

export function useContentVersions(id: string | null) {
  return useQuery({
    queryKey: queryKeys.owner.contentVersions(id ?? ""),
    queryFn: () => assessmentApi.contentApi.versions(id!),
    enabled: Boolean(id),
  });
}

export function useRestoreContentVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => assessmentApi.contentApi.restore(id, version),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.owner.all }),
  });
}

// ---- Owner Console preferences (live API) ------------------------------------------------------
//
// Deliberately separate from useLiveSiteSettings, which is the Learner App's configuration.
// The two never share a cache key, a hook or a table.

export function useOwnerPreferences() {
  return useQuery({
    queryKey: queryKeys.owner.preferences,
    queryFn: assessmentApi.ownerApi.preferences,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateOwnerPreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => assessmentApi.ownerApi.updatePreferences(input),
    onSuccess: (prefs) => client.setQueryData(queryKeys.owner.preferences, prefs),
  });
}

export function useUploadOwnerWallpaper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => assessmentApi.ownerApi.uploadWallpaper(file),
    onSuccess: (prefs) => client.setQueryData(queryKeys.owner.preferences, prefs),
  });
}

export function useRemoveOwnerWallpaper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: assessmentApi.ownerApi.removeWallpaper,
    onSuccess: (prefs) => client.setQueryData(queryKeys.owner.preferences, prefs),
  });
}

export function useOwnerSessions() {
  return useQuery({ queryKey: queryKeys.owner.sessions, queryFn: assessmentApi.ownerApi.sessions });
}

export function useRevokeOwnerSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assessmentApi.ownerApi.revokeSession(id),
    onSuccess: (sessions) => client.setQueryData(queryKeys.owner.sessions, sessions),
  });
}

export function useRevokeOtherOwnerSessions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: assessmentApi.ownerApi.revokeOtherSessions,
    onSuccess: (sessions) => client.setQueryData(queryKeys.owner.sessions, sessions),
  });
}

export function useOwnerSignIns() {
  return useQuery({ queryKey: queryKeys.owner.signIns, queryFn: assessmentApi.ownerApi.signIns });
}

// ---- Grammar Map and the content builder (live API) --------------------------------------------

export function useGrammarMap(
  query: { lang?: string; search?: string; status?: string; level?: string; category?: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.owner.grammarMap(query as Record<string, string | number | undefined>),
    queryFn: () => assessmentApi.grammarMapApi.map(query),
    placeholderData: keepPreviousData,
    // The whole curriculum is a big read. Callers that only need it once something is open —
    // the schema dialog — say so, rather than fetching it behind a closed door.
    enabled: options?.enabled ?? true,
  });
}

export function useGrammarContent(slug: string | null, lang: string) {
  return useQuery({
    queryKey: queryKeys.owner.grammarContent(slug ?? "", lang),
    queryFn: () => assessmentApi.grammarMapApi.content(slug!, lang),
    enabled: Boolean(slug),
  });
}

export function useGrammarValidation(slug: string | null, lang: string) {
  return useQuery({
    queryKey: queryKeys.owner.grammarValidation(slug ?? "", lang),
    queryFn: () => assessmentApi.grammarMapApi.validate(slug!, lang),
    enabled: Boolean(slug),
  });
}

/** Writes the whole topic in one request; the result replaces the cached content. */
export function useGenerateGrammarContent(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { language: string; levels: string[]; overwrite?: boolean }) =>
      assessmentApi.grammarMapApi.generate(slug, input),
    onSuccess: (content) => {
      client.setQueryData(queryKeys.owner.grammarContent(slug, content.language), content);
      client.invalidateQueries({ queryKey: queryKeys.owner.grammarValidation(slug, content.language) });
    },
  });
}

export function useSaveGrammarLevel(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ level, input }: { level: string; input: Record<string, unknown> }) =>
      assessmentApi.grammarMapApi.saveLevel(slug, level, input),
    onSuccess: (content) => {
      client.setQueryData(queryKeys.owner.grammarContent(slug, content.language), content);
      client.invalidateQueries({ queryKey: queryKeys.owner.grammarValidation(slug, content.language) });
    },
  });
}

export function usePublishGrammarContent(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { language: string; levels?: string[] }) => assessmentApi.grammarMapApi.publish(slug, input),
    onSuccess: (content) => {
      client.setQueryData(queryKeys.owner.grammarContent(slug, content.language), content);
      // The map's status for this topic has just changed.
      client.invalidateQueries({ queryKey: queryKeys.owner.all });
    },
  });
}
