/**
 * Live owner API: the question bank and assessment configuration.
 *
 * Unlike the rest of ./index.ts, nothing here is mocked — these functions call the Go API
 * (`/api/v1/admin/...`) through the app's own client, so what the console shows is what the
 * database holds and what learners will actually meet in a placement test.
 *
 * The API enforces the `assessments:read` / `assessments:manage` permissions; this layer only
 * shapes requests and surfaces failures.
 */

import { apiClient } from "@/lib/api";

import type {
  AuditRow,
  EntitlementRow,
  LimitPeriod,
  PlanRow,
  AssessmentAttempt,
  AssessmentConfig,
  AssessmentStats,
  Paged,
  QuestionDetail,
  QuestionInput,
  QuestionQuery,
  QuestionRow,
  QuestionStats,
  QuestionStatus,
} from "../types";

/**
 * The API's page envelope, restated in the console's own Paged shape. total_pages is derived
 * here rather than sent, because the API reports total and page size like every other list.
 */
function paged<T>(result: { items: T[]; meta: { page?: number; page_size?: number; total: number } }, fallbackSize: number): Paged<T> {
  const size = result.meta.page_size ?? fallbackSize;
  return {
    items: result.items,
    page: result.meta.page ?? 1,
    page_size: size,
    total: result.meta.total,
    total_pages: Math.max(1, Math.ceil(result.meta.total / Math.max(1, size))),
  };
}

export async function getQuestions(query: QuestionQuery): Promise<Paged<QuestionRow>> {
  const result = await apiClient.getPage<QuestionRow>("/admin/questions", {
    query: {
      kind: query.kind,
      skill: query.skill === "all" ? undefined : query.skill,
      level: query.level === "all" ? undefined : query.level,
      status: query.status === "all" ? undefined : query.status,
      item_type: query.item_type === "all" ? undefined : query.item_type,
      topic: query.topic,
      search: query.search,
      sort: query.sort,
      page: query.page,
      page_size: query.page_size ?? 20,
    },
  });
  return paged(result, query.page_size ?? 20);
}

export function getQuestion(id: string): Promise<QuestionDetail> {
  return apiClient.get<QuestionDetail>(`/admin/questions/${id}`);
}

export function getQuestionStats(): Promise<QuestionStats> {
  return apiClient.get<QuestionStats>("/admin/questions/stats");
}

export function createQuestion(input: QuestionInput): Promise<QuestionDetail> {
  return apiClient.post<QuestionDetail>("/admin/questions", input);
}

export function updateQuestion(id: string, input: QuestionInput): Promise<QuestionDetail> {
  return apiClient.patch<QuestionDetail>(`/admin/questions/${id}`, input);
}

export function setQuestionStatus(id: string, status: QuestionStatus): Promise<QuestionDetail> {
  return apiClient.post<QuestionDetail>(`/admin/questions/${id}/status`, { status });
}

export function getAssessmentConfigs(): Promise<AssessmentConfig[]> {
  return apiClient.get<AssessmentConfig[]>("/admin/assessment-configs");
}

export function createAssessmentConfig(input: { kind: string; config: unknown }): Promise<AssessmentConfig> {
  return apiClient.post<AssessmentConfig>("/admin/assessment-configs", input);
}

export function activateAssessmentConfig(id: string): Promise<{ id: string; kind: string; version: number }> {
  return apiClient.post(`/admin/assessment-configs/${id}/activate`, {});
}

export async function getAssessmentAttempts(query: {
  kind?: string;
  status?: string;
  level?: string;
  days?: number;
  page?: number;
}): Promise<Paged<AssessmentAttempt>> {
  const result = await apiClient.getPage<AssessmentAttempt>("/admin/assessment-attempts", {
    query: {
      kind: query.kind,
      status: query.status === "all" ? undefined : query.status,
      level: query.level === "all" ? undefined : query.level,
      days: query.days,
      page: query.page,
      page_size: 20,
    },
  });
  return paged(result, 20);
}

export function getAssessmentStats(days: number): Promise<AssessmentStats> {
  return apiClient.get<AssessmentStats>("/admin/assessment-stats", { query: { days } });
}

// ---- Plans, entitlements and audit ------------------------------------------------------------

export function getPlans(): Promise<PlanRow[]> {
  return apiClient.get<PlanRow[]>("/admin/plans");
}

export function getEntitlements(): Promise<EntitlementRow[]> {
  return apiClient.get<EntitlementRow[]>("/admin/entitlements");
}

/** Grants the entitlement to the plan, or changes its limit. `limit_value: null` = unlimited. */
export function setPlanEntitlement(input: {
  planId: string;
  key: string;
  limit_value?: number | null;
  limit_period?: LimitPeriod | null;
}): Promise<unknown> {
  return apiClient.put(`/admin/plans/${input.planId}/entitlements/${input.key}`, {
    limit_value: input.limit_value ?? undefined,
    limit_period: input.limit_period ?? undefined,
  });
}

export function revokePlanEntitlement(planId: string, key: string): Promise<unknown> {
  return apiClient.delete(`/admin/plans/${planId}/entitlements/${key}`);
}

export async function getAuditLogs(query: { action?: string; entity?: string; days?: number; page?: number }): Promise<Paged<AuditRow>> {
  const result = await apiClient.getPage<AuditRow>("/admin/audit-logs", {
    query: { action: query.action, entity: query.entity, days: query.days, page: query.page, page_size: 25 },
  });
  return paged(result, 25);
}
