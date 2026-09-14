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
} as const;
