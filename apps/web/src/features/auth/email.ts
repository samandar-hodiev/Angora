"use client";

import type { EmailChallenge } from "@engora/types";
import { useMutation, useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";

import { useSession } from "./hooks";

export interface PasswordStatus {
  has_password: boolean;
  auth_provider: "email" | "google" | "apple" | "phone";
}

/** Email sign-up with verification codes (the code itself is only ever checked by the API). */
export const emailAuthApi = {
  start: (email: string) => apiClient.post<EmailChallenge>("/auth/email/start", { email }, { auth: false }),
  resend: (email: string) => apiClient.post<EmailChallenge>("/auth/email/resend", { email }, { auth: false }),
  setPassword: (password: string) => apiClient.post<void>("/auth/password/set", { password }),
  passwordStatus: () => apiClient.get<PasswordStatus>("/auth/password/status"),
};

export function useStartEmailSignup() {
  return useMutation({ mutationFn: emailAuthApi.start });
}

export function useResendEmailCode() {
  return useMutation({ mutationFn: emailAuthApi.resend });
}

export function useSetPassword() {
  return useMutation({ mutationFn: emailAuthApi.setPassword });
}

export function usePasswordStatus() {
  const { status } = useSession();
  return useQuery({ queryKey: ["auth", "password-status"], queryFn: emailAuthApi.passwordStatus, enabled: status === "authenticated" });
}

/** The machine-readable reason the API attached to an error (e.g. "email_registered"). */
export function errorReason(error: unknown): string | undefined {
  if (!isApiError(error)) return undefined;
  const reason = error.details?.reason;
  return typeof reason === "string" ? reason : undefined;
}

export function errorNumber(error: unknown, key: string): number | undefined {
  if (!isApiError(error)) return undefined;
  const value = error.details?.[key];
  return typeof value === "number" ? value : undefined;
}
