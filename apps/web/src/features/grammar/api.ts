import type {
  GrammarAttempt,
  GrammarCategory,
  GrammarComparison,
  GrammarExplanationResponse,
  GrammarFeedback,
  GrammarMapNode,
  GrammarOverview,
  GrammarProgressOverview,
  GrammarResponse,
  GrammarResult,
  GrammarSearchResponse,
  GrammarTopic,
  GrammarTopicSummary,
  GrammarTutorReply,
  GrammarVisual,
} from "@engora/types";

import { apiClient } from "@/lib/api";

/** "me" resolves to the learner's own CEFR level on the server, from their profile. */
export type GrammarLevelFilter = "all" | "me" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const grammarApi = {
  categories: () => apiClient.get<GrammarCategory[]>("/grammar/categories"),

  topics: (filters: { category?: string; level?: GrammarLevelFilter; group?: string }) =>
    apiClient.get<GrammarTopicSummary[]>("/grammar/topics", {
      query: { category: filters.category, level: filters.level === "all" ? undefined : filters.level, group: filters.group },
    }),

  /** Server-side: the curriculum outgrows what a client can hold and filter. */
  search: (q: string, level: GrammarLevelFilter, signal?: AbortSignal) =>
    apiClient.get<GrammarSearchResponse>("/grammar/search", {
      query: { q, level: level === "all" ? undefined : level },
      signal,
    }),

  // `lang` is only sent when the learner picks one: with no parameter the API serves the
  // language on their profile, which is the same field the AI tutor writes in.
  topic: (slug: string, lang?: string) =>
    apiClient.get<GrammarTopic>(`/grammar/topics/${slug}`, { query: { lang } }),
  comparison: (slug: string, other: string) =>
    apiClient.get<GrammarComparison>(`/grammar/topics/${slug}/compare/${other}`),
  map: () => apiClient.get<GrammarMapNode[]>("/grammar/map"),
  overview: () => apiClient.get<GrammarOverview>("/grammar/overview"),
  progress: () => apiClient.get<GrammarProgressOverview>("/grammar/progress"),

  startPractice: (slug: string, body: { mode?: "learning" | "test"; limit?: number; rule?: string }) =>
    apiClient.post<GrammarAttempt>(`/grammar/topics/${slug}/practice`, body),
  attempt: (id: string) => apiClient.get<GrammarAttempt | GrammarResult>(`/grammar/attempts/${id}`),
  answer: (attemptId: string, body: { question_id: string; response: GrammarResponse; response_ms?: number }) =>
    apiClient.post<GrammarFeedback>(`/grammar/attempts/${attemptId}/answers`, body),
  complete: (attemptId: string) => apiClient.post<GrammarResult>(`/grammar/attempts/${attemptId}/complete`),

  explain: (slug: string) => apiClient.post<GrammarExplanationResponse>(`/grammar/topics/${slug}/ai/explain`, {}),
  ask: (slug: string, question: string, history: { role: "user" | "assistant"; content: string }[]) =>
    apiClient.post<GrammarTutorReply>(`/grammar/topics/${slug}/ai/ask`, { question, history }),
  visualize: (slug: string, kind?: string, compare?: string) =>
    apiClient.post<GrammarVisual>(`/grammar/topics/${slug}/ai/visual`, { kind, compare }),
};
