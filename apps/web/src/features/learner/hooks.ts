"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ReviewRating, VocabularyLibraryQuery } from "@engora/types";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { learnerApi } from "./api";

function useAuthed() {
  return useSession().status === "authenticated";
}

export function useProgress() {
  return useQuery({
    queryKey: queryKeys.progress.overview,
    queryFn: learnerApi.progress,
    enabled: useAuthed(),
  });
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
  return useQuery({
    queryKey: queryKeys.mistakes.summary,
    queryFn: learnerApi.mistakeSummary,
    enabled: useAuthed(),
  });
}

export function useMistakes(group = "", page = 1) {
  return useQuery({
    queryKey: queryKeys.mistakes.list(group, page),
    queryFn: () => learnerApi.mistakes(group, page),
    enabled: useAuthed(),
    placeholderData: keepPreviousData,
  });
}

export function useVocabularyLibrary(query: VocabularyLibraryQuery) {
  return useQuery({
    queryKey: queryKeys.vocabulary.library(query),
    queryFn: () => learnerApi.vocabularyLibrary(query),
    enabled: useAuthed(),
    placeholderData: keepPreviousData,
  });
}

export function useVocabularyWord(id: string | null) {
  return useQuery({
    queryKey: queryKeys.vocabulary.word(id ?? ""),
    queryFn: () => learnerApi.vocabularyWord(id!),
    enabled: useAuthed() && !!id,
    // Usage notes are written on the first open; reopening the same word should not wait again.
    staleTime: 5 * 60_000,
  });
}

/** Every change to the deck moves the library badges, the word page and the counters together. */
function useDeckMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["vocabulary"] }),
  });
}

export function useAddToDeck() {
  return useDeckMutation(learnerApi.addToDeck);
}

export function useRemoveFromDeck() {
  return useDeckMutation(learnerApi.removeFromDeck);
}

export function useMarkKnown() {
  return useDeckMutation(learnerApi.markKnown);
}

export function useVocabularyDeck(page = 1, filter = "", kind = "") {
  return useQuery({
    queryKey: queryKeys.vocabulary.deck(page, filter, kind),
    queryFn: () => learnerApi.vocabularyDeck(page, filter, kind),
    enabled: useAuthed(),
    placeholderData: keepPreviousData,
  });
}

export function useReviewWord() {
  return useMutation({
    mutationFn: ({ id, rating, responseMs }: { id: string; rating: ReviewRating; responseMs?: number }) =>
      learnerApi.reviewWord(id, rating, responseMs),
  });
}

export function useCompareWords() {
  return useMutation({ mutationFn: learnerApi.compareWords });
}

export function useLadder() {
  return useMutation({ mutationFn: learnerApi.ladder });
}

export function useRecommendations() {
  return useQuery({
    queryKey: queryKeys.recommendations.list,
    queryFn: learnerApi.recommendations,
    enabled: useAuthed(),
  });
}

export function useLearningPlan() {
  return useQuery({
    queryKey: queryKeys.recommendations.plan,
    queryFn: learnerApi.learningPlan,
    enabled: useAuthed(),
  });
}
