"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";

import { coachApi, ieltsApi, practiceApi, speakingApi, writingApi, type PracticeAnswer, type PracticeSkill } from "./api";

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

export function useSpeakingTasks() {
  return useQuery({ queryKey: queryKeys.practice.speakingTasks, queryFn: speakingApi.tasks });
}

export function useSpeakingSessions() {
  return useQuery({ queryKey: queryKeys.practice.speakingSessions, queryFn: speakingApi.sessions });
}

export function useSubmitSpeaking() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: speakingApi.submit,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.practice.speakingSessions });
      void client.invalidateQueries({ queryKey: queryKeys.progress.overview });
    },
  });
}

export function useIELTSExams() {
  return useQuery({ queryKey: queryKeys.practice.ieltsExams, queryFn: ieltsApi.exams });
}

export function useIELTSAttempts() {
  return useQuery({ queryKey: queryKeys.practice.ieltsAttempts, queryFn: ieltsApi.attempts });
}

export function useStartIELTSExam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ieltsApi.start,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.practice.ieltsAttempts }),
  });
}

export function useCoachConversations() {
  return useQuery({ queryKey: queryKeys.practice.coachConversations, queryFn: coachApi.conversations });
}

export function useSendCoachMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: coachApi.send,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.practice.coachConversations }),
  });
}
