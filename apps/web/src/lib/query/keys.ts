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
    all: ["grammar"] as const,
    categories: ["grammar", "categories"] as const,
    topics: (category: string, level: string) => ["grammar", "topics", category, level] as const,
    search: (query: string, level: string) => ["grammar", "search", query, level] as const,
    topic: (slug: string) => ["grammar", "topic", slug] as const,
    explanation: (slug: string) => ["grammar", "explanation", slug] as const,
    comparison: (slug: string, other: string) => ["grammar", "compare", slug, other] as const,
    map: ["grammar", "map"] as const,
    overview: ["grammar", "overview"] as const,
    progress: ["grammar", "progress"] as const,
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
  /** Owner console. Backed by the mock service layer in features/owner/services for now. */
  owner: {
    all: ["owner"] as const,
    dashboard: (plan: string) => ["owner", "dashboard", plan] as const,
    growth: (range: string) => ["owner", "growth", range] as const,
    planDistribution: ["owner", "plan-distribution"] as const,
    activitySummary: ["owner", "activity-summary"] as const,
    conversions: ["owner", "conversions"] as const,
    recentLearners: ["owner", "recent-learners"] as const,
    recentConversions: ["owner", "recent-conversions"] as const,
    contentStats: ["owner", "content-stats"] as const,
    activityFeed: ["owner", "activity-feed"] as const,
    health: ["owner", "health"] as const,
    content: (filters: Record<string, string | number | undefined>) => ["owner", "content", filters] as const,
    grammarCategories: ["owner", "grammar", "categories"] as const,
    grammarTopics: (filters: Record<string, string | number | undefined>) => ["owner", "grammar", "topics", filters] as const,
    grammarTopic: (slug: string) => ["owner", "grammar", "topic", slug] as const,
    features: ["owner", "features"] as const,
    settings: ["owner", "settings"] as const,
    wallpapers: ["owner", "wallpapers"] as const,
    learners: (filters: Record<string, string | number | undefined>) => ["owner", "learners", filters] as const,
    learner: (id: string) => ["owner", "learner", id] as const,
  },
  admin: {
    overview: ["admin", "overview"] as const,
    aiUsage: (days: number) => ["admin", "ai-usage", days] as const,
    content: (filters: Record<string, string | number | undefined>) => ["admin", "content", filters] as const,
    users: (page: number) => ["admin", "users", page] as const,
  },
} as const;
