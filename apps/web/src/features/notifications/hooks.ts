"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { notificationsApi } from "./api";

export function useNotifications(unreadOnly = false) {
  const { status } = useSession();
  return useQuery({
    queryKey: queryKeys.notifications.list(unreadOnly),
    queryFn: () => notificationsApi.list(unreadOnly),
    enabled: status === "authenticated",
    // Notifications arrive from things the learner did not do — a payment confirming, a
    // reminder firing — so the bell has to find out on its own.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.read(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.readAll(),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}

export function useNotificationPreferences() {
  const { status } = useSession();
  return useQuery({
    queryKey: queryKeys.notifications.preferences,
    queryFn: notificationsApi.preferences,
    enabled: status === "authenticated",
  });
}

export function useUpdateNotificationPreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.updatePreferences,
    onSuccess: (prefs) => client.setQueryData(queryKeys.notifications.preferences, prefs),
  });
}
