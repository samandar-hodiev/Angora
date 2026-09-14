import type { Profile } from "@engora/types";
import type { ProfileUpdateInput } from "@engora/validation";

import { apiClient } from "@/lib/api";

export const profileApi = {
  get: () => apiClient.get<Profile>("/profile"),
  update: (input: ProfileUpdateInput) => apiClient.patch<Profile>("/profile", input),
};
