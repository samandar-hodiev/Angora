"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { profileApi } from "./api";

export function useProfile() {
  const { status } = useSession();
  return useQuery({ queryKey: queryKeys.profile.me, queryFn: profileApi.get, enabled: status === "authenticated" });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: profileApi.update,
    onSuccess: (profile) => queryClient.setQueryData(queryKeys.profile.me, profile),
  });
}
