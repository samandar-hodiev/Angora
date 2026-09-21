"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { paymentsApi } from "./api";

export function usePaymentMethods() {
  return useQuery({
    queryKey: queryKeys.payments.methods,
    queryFn: paymentsApi.methods,
    staleTime: 10 * 60_000,
  });
}

export function usePaymentHistory() {
  const { status } = useSession();
  return useQuery({
    queryKey: queryKeys.payments.transactions,
    queryFn: paymentsApi.transactions,
    enabled: status === "authenticated",
  });
}

/**
 * Starts a checkout. The transaction is recorded here and the learner is sent to the
 * provider's own page to enter their card — we never see it, and there is no code path in
 * this app that could accept it.
 */
export function useCheckout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (planCode: string) => paymentsApi.checkout(planCode),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.payments.transactions }),
  });
}
