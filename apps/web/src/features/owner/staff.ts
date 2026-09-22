"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";

/**
 * Who else runs the platform.
 *
 * Owner-only, and the API says so too — this module exists so the console can show the page,
 * not so it can decide who sees it. A staff role is never "OWNER": there is one owner, set in
 * the server's configuration, and nothing in this console can mint another.
 */

export type StaffRole = "ANALYST" | "SUPPORT" | "CONTENT_MANAGER" | "ADMIN";

export interface StaffMember {
  id: string;
  email: string;
  role: StaffRole | "OWNER";
  status: string;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  created_by_email: string | null;
  active_sessions: number;
}

export interface StaffRoleOption {
  role: StaffRole;
  permissions: string[];
}

export const staffApi = {
  list: () => apiClient.get<StaffMember[]>("/admin/staff"),
  roles: () => apiClient.get<StaffRoleOption[]>("/admin/staff/roles"),
  add: (input: { email: string; role: StaffRole; password: string }) =>
    apiClient.post<StaffMember>("/admin/staff", input),
  changeRole: (id: string, role: StaffRole) => apiClient.patch<void>(`/admin/staff/${id}`, { role }),
  resetPassword: (id: string, password: string) => apiClient.post<void>(`/admin/staff/${id}/password`, { password }),
  revoke: (id: string) => apiClient.delete<void>(`/admin/staff/${id}`),
};

const staffKey = ["owner", "staff"] as const;

export function useStaff() {
  return useQuery({ queryKey: staffKey, queryFn: staffApi.list });
}

export function useStaffRoles() {
  return useQuery({ queryKey: [...staffKey, "roles"], queryFn: staffApi.roles, staleTime: 60 * 60 * 1000 });
}

/** Every change re-reads the list: session counts and flags move when roles do. */
function useStaffMutation<TInput>(fn: (input: TInput) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: staffKey }),
  });
}

export function useAddStaff() {
  return useStaffMutation(staffApi.add);
}

export function useChangeStaffRole() {
  return useStaffMutation(({ id, role }: { id: string; role: StaffRole }) => staffApi.changeRole(id, role));
}

export function useResetStaffPassword() {
  return useStaffMutation(({ id, password }: { id: string; password: string }) => staffApi.resetPassword(id, password));
}

export function useRevokeStaff() {
  return useStaffMutation(({ id }: { id: string }) => staffApi.revoke(id));
}

/**
 * A first password the owner has to read out or paste into a message.
 *
 * Generated rather than typed: a password somebody invents on the spot for someone else is
 * almost always a pattern they have used before. Ambiguous characters are left out because
 * this one gets read aloud and retyped.
 */
export function suggestPassword(length = 16): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}
