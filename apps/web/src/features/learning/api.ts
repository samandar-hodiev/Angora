import type { Level, Skill } from "@engora/types";

import { apiClient } from "@/lib/api";

export const learningApi = {
  skills: () => apiClient.get<Skill[]>("/learning/skills", { auth: false }),
  levels: () => apiClient.get<Level[]>("/learning/levels", { auth: false }),
};
