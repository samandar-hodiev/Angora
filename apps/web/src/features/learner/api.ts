import type {
  ComparisonResponse,
  HistoryItem,
  LearningPlan,
  Mistake,
  MistakeSummary,
  ProgressForecast,
  ProgressOverview,
  Recommendation,
  ReviewQueue,
  ReviewRating,
  ReviewResult,
  VocabularyDeck,
  VocabularyLibrary,
  VocabularyLibraryQuery,
  WordDetail,
} from "@engora/types";

import { apiClient } from "@/lib/api";

/**
 * Learner read models. These are the same resources the mobile apps will request:
 * /progress, /history, /mistakes, /vocabulary/deck, /recommendations,
 * /learning-plan.
 */
export const learnerApi = {
  progress: () => apiClient.get<ProgressOverview>("/progress"),
  forecast: () => apiClient.get<ProgressForecast>("/progress/forecast"),
  history: (page: number) => apiClient.getPage<HistoryItem>("/history", { query: { page, page_size: 20 } }),
  mistakeSummary: () => apiClient.get<MistakeSummary>("/mistakes/summary"),
  mistakes: (group: string, page: number) =>
    apiClient.getPage<Mistake>("/mistakes", { query: { group, page, page_size: 20 } }),
  vocabularyDeck: (page: number, filter: string) =>
    apiClient.request<VocabularyDeck>("/vocabulary/deck", { query: { page, filter, page_size: 24 } }),
  vocabularyLibrary: (query: VocabularyLibraryQuery) =>
    apiClient.request<VocabularyLibrary>("/vocabulary/library", { query: { ...query, page_size: 30 } }),
  vocabularyWord: (id: string) => apiClient.get<WordDetail>(`/vocabulary/words/${id}`),
  compareWords: (terms: string[]) => apiClient.post<ComparisonResponse>("/vocabulary/compare", { terms }),
  reviewQueue: () => apiClient.get<ReviewQueue>("/vocabulary/review", { query: { limit: 20 } }),
  reviewWord: (id: string, rating: ReviewRating, responseMs?: number) =>
    apiClient.post<ReviewResult>(`/vocabulary/review/${id}`, { rating, response_ms: responseMs }),
  addToDeck: (id: string) => apiClient.post<{ added: boolean }>(`/vocabulary/deck/${id}`),
  removeFromDeck: (id: string) => apiClient.delete<{ removed: boolean }>(`/vocabulary/deck/${id}`),
  markKnown: (id: string) => apiClient.post<{ status: string; mastery: number }>(`/vocabulary/deck/${id}/known`),
  recommendations: () => apiClient.get<Recommendation[]>("/recommendations"),
  learningPlan: () => apiClient.get<{ plan: LearningPlan | null }>("/learning-plan").then((r) => r.plan),
};
