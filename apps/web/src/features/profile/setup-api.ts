"use client";

import type { Profile } from "@engora/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";

export interface ProfileSetupPayload {
  first_name: string;
  last_name?: string;
  phone_country?: string;
  phone_number?: string;
}

/** Account profile (identity) endpoints, separate from authentication and onboarding. */
export const profileSetupApi = {
  setup: (input: ProfileSetupPayload) => apiClient.put<Profile>("/profile/setup", input),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<Profile>("/profile/avatar", form);
  },
  removeAvatar: () => apiClient.delete<Profile>("/profile/avatar"),
  uploadWallpaper: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<Profile>("/profile/wallpaper", form);
  },
  removeWallpaper: () => apiClient.delete<Profile>("/profile/wallpaper"),
};

function useProfileMutation<TVariables>(fn: (variables: TVariables) => Promise<Profile>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.profile.me, profile);
      void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.state });
    },
  });
}

export const useSetupProfile = () => useProfileMutation(profileSetupApi.setup);
export const useUploadAvatar = () => useProfileMutation(profileSetupApi.uploadAvatar);
export const useRemoveAvatar = () => useProfileMutation(() => profileSetupApi.removeAvatar());
export const useUploadWallpaper = () => useProfileMutation(profileSetupApi.uploadWallpaper);
export const useRemoveWallpaper = () => useProfileMutation(() => profileSetupApi.removeWallpaper());
