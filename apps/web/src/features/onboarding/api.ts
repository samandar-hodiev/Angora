import type { OnboardingState, OnboardingStep } from "@engora/types";

import { apiClient } from "@/lib/api";

/**
 * Onboarding is a server-side state machine: every call returns the fresh OnboardingState,
 * so web and mobile always render from the server's answer and can resume anywhere.
 */
export const onboardingApi = {
  get: () => apiClient.get<OnboardingState>("/onboarding"),
  start: () => apiClient.post<OnboardingState>("/onboarding/start"),
  setGoals: (goals: string[]) => apiClient.put<OnboardingState>("/onboarding/goals", { goals }),
  setDailyTime: (minutes: number) => apiClient.put<OnboardingState>("/onboarding/daily-time", { minutes }),
  chooseLevel: (level: string) => apiClient.put<OnboardingState>("/onboarding/level", { level }),
  choosePlacement: () => apiClient.post<OnboardingState>("/onboarding/placement"),
  startPlacement: (level: string) => apiClient.put<OnboardingState>("/onboarding/placement/start-level", { level }),
  abandonPlacement: () => apiClient.post<OnboardingState>("/onboarding/placement/abandon"),
  resultsViewed: () => apiClient.post<OnboardingState>("/onboarding/results-viewed"),
  regeneratePlan: () => apiClient.post<OnboardingState>("/onboarding/plan"),
  navigate: (step: OnboardingStep) => apiClient.put<OnboardingState>("/onboarding/step", { step }),
  complete: () => apiClient.post<OnboardingState>("/onboarding/complete"),
};
