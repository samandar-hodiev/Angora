"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { learnerApi } from "./api";

function useAuthed() {
  return useSession().status === "authenticated";
}

export function useProgress() {
  return useQuery({ queryKey: queryKeys.progress.overview, queryFn: learnerApi.progress, enabled: useAuthed() });
}

export function useForecast() {
  return useQuery({
    queryKey: queryKeys.progress.forecast,
    queryFn: learnerApi.forecast,
    enabled: useAuthed(),
    // A projection built from weekly averages does not move between page views.
    staleTime: 30 * 60_000,
  });
}

export function useHistory(page = 1) {
  return useQuery({
    queryKey: queryKeys.progress.history(page),
    queryFn: () => learnerApi.history(page),
    enabled: useAuthed(),
    placeholderData: keepPreviousData,
  });
}

export function useMistakeSummary() {
  return useQuery({ queryKey: queryKeys.mistakes.summary, queryFn: learnerApi.mistakeSummary, enabled: useAuthed() });
}

export function useMistakes(group = "", page = 1) {
  return useQuery({
    queryKey: queryKeys.mistakes.list(group, page),
    queryFn: () => learnerApi.mistakes(group, page),
    enabled: useAuthed(),
    placeholderData: keepPreviousData,
  });
}

export function useVocabularyDeck(page = 1) {
  return useQuery({
    queryKey: queryKeys.vocabulary.deck(page),
    queryFn: () => learnerApi.vocabularyDeck(page),
    enabled: useAuthed(),
    placeholderData: keepPreviousData,
  });
}

export function useRecommendations() {
  return useQuery({ queryKey: queryKeys.recommendations.list, queryFn: learnerApi.recommendations, enabled: useAuthed() });
}

export function useLearningPlan() {
  return useQuery({ queryKey: queryKeys.recommendations.plan, queryFn: learnerApi.learningPlan, enabled: useAuthed() });
}
