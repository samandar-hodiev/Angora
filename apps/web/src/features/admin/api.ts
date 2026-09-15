"use client";

import type { AdminContentRow, AdminOverview, AIUsageReport, User } from "@engora/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";

export interface AdminContentFilters {
  type?: string;
  skill?: string;
  level?: string;
  status?: string;
  page?: number;
}

export const adminApi = {
  overview: () => apiClient.get<AdminOverview>("/admin/overview"),
  aiUsage: (days: number) => apiClient.get<AIUsageReport>("/admin/ai-usage", { query: { days } }),
  content: (filters: AdminContentFilters) =>
    apiClient.getPage<AdminContentRow>("/admin/content", { query: { ...filters, page_size: 25 } }),
  users: (page: number) => apiClient.getPage<User>("/admin/users", { query: { page, page_size: 25 } }),
};

/** UI hint only: the API enforces admin permissions on every /admin route. */
export function useIsAdmin(): boolean {
  return useSession().user?.role === "ADMIN";
}

export function useAdminOverview() {
  return useQuery({ queryKey: queryKeys.admin.overview, queryFn: adminApi.overview, enabled: useIsAdmin() });
}

export function useAIUsage(days: number) {
  return useQuery({
    queryKey: queryKeys.admin.aiUsage(days),
    queryFn: () => adminApi.aiUsage(days),
    enabled: useIsAdmin(),
    placeholderData: keepPreviousData,
  });
}

export function useAdminContent(filters: AdminContentFilters) {
  return useQuery({
    queryKey: queryKeys.admin.content({ ...filters }),
    queryFn: () => adminApi.content(filters),
    enabled: useIsAdmin(),
    placeholderData: keepPreviousData,
  });
}

export function useAdminUsers(page: number) {
  return useQuery({
    queryKey: queryKeys.admin.users(page),
    queryFn: () => adminApi.users(page),
    enabled: useIsAdmin(),
    placeholderData: keepPreviousData,
  });
}
