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
