/**
 * Query key factory. Centralizing keys keeps cache invalidation predictable:
 * e.g. queryClient.invalidateQueries({ queryKey: queryKeys.profile.all }).
 */
export const queryKeys = {
  system: {
    health: ["system", "health"] as const,
  },
  learning: {
    all: ["learning"] as const,
    skills: ["learning", "skills"] as const,
    levels: ["learning", "levels"] as const,
    content: (filters: Record<string, string | number | undefined>) => ["learning", "content", filters] as const,
    contentItem: (id: string) => ["learning", "content-item", id] as const,
  },
  subscription: {
    all: ["subscription"] as const,
    plans: ["subscription", "plans"] as const,
    current: ["subscription", "current"] as const,
  },
  profile: {
    all: ["profile"] as const,
    me: ["profile", "me"] as const,
  },
  progress: {
    overview: ["progress", "overview"] as const,
    history: (page: number) => ["progress", "history", page] as const,
  },
  mistakes: {
    summary: ["mistakes", "summary"] as const,
    list: (group: string, page: number) => ["mistakes", "list", group, page] as const,
  },
  vocabulary: {
    deck: (page: number) => ["vocabulary", "deck", page] as const,
  },
  grammar: {
    topics: ["grammar", "topics"] as const,
  },
  recommendations: {
    list: ["recommendations"] as const,
    plan: ["learning-plan"] as const,
  },
  onboarding: {
    state: ["onboarding"] as const,
  },
  levels: {
    me: ["levels", "me"] as const,
  },
  assessments: {
    all: ["assessments"] as const,
    history: ["assessments", "history"] as const,
    config: ["assessments", "config"] as const,
    detail: (id: string) => ["assessments", id] as const,
    section: (id: string, skill: string) => ["assessments", id, "section", skill] as const,
    result: (id: string) => ["assessments", id, "result"] as const,
  },
  admin: {
    overview: ["admin", "overview"] as const,
    aiUsage: (days: number) => ["admin", "ai-usage", days] as const,
    content: (filters: Record<string, string | number | undefined>) => ["admin", "content", filters] as const,
    users: (page: number) => ["admin", "users", page] as const,
  },
} as const;
