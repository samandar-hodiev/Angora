"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { login, loginWithGoogle, logout, register, sessionStore, verifyEmailCode } from "./session";

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: verifyEmailCode,
    onSuccess: () => queryClient.clear(),
  });
}

export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
}

export function useLogin(landing?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof login>[0]) => login(input, landing),
    // Never show a previous user's cached data to the next one.
    onSuccess: () => queryClient.clear(),
  });
}

export function useGoogleLogin(landing?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof loginWithGoogle>[0]) => loginWithGoogle(input, landing),
    // Never show a previous user's cached data to the next one.
    onSuccess: () => queryClient.clear(),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: () => queryClient.clear(),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => queryClient.clear(),
  });
}
