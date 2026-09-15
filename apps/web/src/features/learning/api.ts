import type { ContentItem, ContentSummary, Level, Skill } from "@engora/types";

import { apiClient } from "@/lib/api";

export interface ContentFilters {
  type?: string;
  skill?: string;
  level?: string;
  exam?: string;
  tag?: string;
  page?: number;
  page_size?: number;
}

export const learningApi = {
  skills: () => apiClient.get<Skill[]>("/learning/skills", { auth: false }),
  levels: () => apiClient.get<Level[]>("/learning/levels", { auth: false }),
  content: (filters: ContentFilters) =>
    apiClient.getPage<ContentSummary>("/learning/content", { query: { ...filters } }),
  contentItem: <Body>(id: string) => apiClient.get<ContentItem<Body>>(`/learning/content/${id}`),
};
