"use client";

import type { OnboardingState, OnboardingStep } from "@engora/types";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { onboardingApi } from "./api";

export function useOnboarding() {
  const { status } = useSession();
  return useQuery({
    queryKey: queryKeys.onboarding.state,
    queryFn: onboardingApi.get,
    enabled: status === "authenticated",
    staleTime: 30_000,
  });
}

function useOnboardingMutation<TVariables = void>(fn: (variables: TVariables) => Promise<OnboardingState>, invalidate: QueryKey[] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (state) => {
      queryClient.setQueryData(queryKeys.onboarding.state, state);
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.state }),
  });
}

const afterLevel = [queryKeys.recommendations.plan, queryKeys.profile.me, queryKeys.progress.overview, queryKeys.levels.me];

export const useStartOnboarding = () => useOnboardingMutation(() => onboardingApi.start());
export const useSetGoals = () => useOnboardingMutation((goals: string[]) => onboardingApi.setGoals(goals), [queryKeys.profile.me]);
export const useSetDailyTime = () => useOnboardingMutation((minutes: number) => onboardingApi.setDailyTime(minutes), [queryKeys.profile.me]);
export const useChooseLevel = () => useOnboardingMutation((level: string) => onboardingApi.chooseLevel(level), afterLevel);
export const useChoosePlacement = () => useOnboardingMutation(() => onboardingApi.choosePlacement());
export const useStartPlacement = () =>
  useOnboardingMutation((level: string) => onboardingApi.startPlacement(level), [queryKeys.assessments.all, queryKeys.levels.me]);
export const useAbandonPlacement = () => useOnboardingMutation(() => onboardingApi.abandonPlacement(), [queryKeys.assessments.all]);
export const useResultsViewed = () => useOnboardingMutation(() => onboardingApi.resultsViewed());
export const useRegeneratePlan = () => useOnboardingMutation(() => onboardingApi.regeneratePlan(), [queryKeys.recommendations.plan]);
export const useNavigateOnboarding = () => useOnboardingMutation((step: OnboardingStep) => onboardingApi.navigate(step));
export const useCompleteOnboarding = () => useOnboardingMutation(() => onboardingApi.complete(), afterLevel);
