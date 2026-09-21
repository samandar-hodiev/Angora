"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";

import { practiceApi, writingApi, type PracticeAnswer, type PracticeSkill } from "./api";

export function usePracticeSets(skill: PracticeSkill) {
  return useQuery({ queryKey: queryKeys.practice.sets(skill), queryFn: () => practiceApi.sets(skill) });
}

export function usePracticeSet(skill: PracticeSkill, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.practice.set(skill, id ?? ""),
    queryFn: () => practiceApi.set(skill, id!),
    enabled: Boolean(id),
  });
}

export function useStartAttempt(skill: PracticeSkill) {
  return useMutation({ mutationFn: (setId: string) => practiceApi.start(skill, setId) });
}

export function useCompleteAttempt(skill: PracticeSkill) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, answers, timeSpentMs }: { attemptId: string; answers: Record<string, PracticeAnswer>; timeSpentMs: number }) =>
      practiceApi.complete(skill, attemptId, answers, timeSpentMs),
    // Finishing changes what the library shows (attempts, best score) and the learner's
    // progress, so both are refetched rather than patched.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.practice.sets(skill) });
      void client.invalidateQueries({ queryKey: queryKeys.progress.overview });
    },
  });
}

export function useWritingTasks() {
  return useQuery({ queryKey: queryKeys.practice.writingTasks, queryFn: writingApi.tasks });
}

export function useWritingSubmissions() {
  return useQuery({ queryKey: queryKeys.practice.writingSubmissions, queryFn: writingApi.submissions });
}

export function useSubmitWriting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: writingApi.submit,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.practice.writingSubmissions });
      void client.invalidateQueries({ queryKey: queryKeys.progress.overview });
    },
  });
}
