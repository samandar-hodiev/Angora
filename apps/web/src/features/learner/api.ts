import type {
  HistoryItem,
  LearningPlan,
  Mistake,
  MistakeSummary,
  ProgressForecast,
  ProgressOverview,
  Recommendation,
  VocabularyDeck,
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
  vocabularyDeck: (page: number) =>
    apiClient.request<VocabularyDeck>("/vocabulary/deck", { query: { page, page_size: 24 } }),
  recommendations: () => apiClient.get<Recommendation[]>("/recommendations"),
  learningPlan: () => apiClient.get<{ plan: LearningPlan | null }>("/learning-plan").then((r) => r.plan),
};
