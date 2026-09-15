"use client";

import { useMutation } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";

export const passwordApi = {
  forgot: (email: string) =>
    apiClient.post<{ message: string }>("/auth/password/forgot", { email }, { auth: false }),
  reset: (token: string, password: string) =>
    apiClient.post<void>("/auth/password/reset", { token, password }, { auth: false }),
};

export function useForgotPassword() {
  return useMutation({ mutationFn: passwordApi.forgot });
}

export function useResetPassword() {
  return useMutation({ mutationFn: (input: { token: string; password: string }) => passwordApi.reset(input.token, input.password) });
}
