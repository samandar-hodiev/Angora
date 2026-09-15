"use client";

import type { Assessment, AssessmentSkill } from "@engora/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/features/auth/hooks";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";

import { assessmentApi } from "./api";

function useAuthed() {
  return useSession().status === "authenticated";
}

function isProcessing(a: Assessment | undefined) {
  return !!a && (a.status === "processing" || a.sections.some((s) => s.status === "evaluating"));
}

export function useAssessmentConfig() {
  return useQuery({ queryKey: queryKeys.assessments.config, queryFn: assessmentApi.config, enabled: useAuthed(), staleTime: 10 * 60_000 });
}

export function useAssessmentHistory() {
  return useQuery({ queryKey: queryKeys.assessments.history, queryFn: assessmentApi.history, enabled: useAuthed() });
}

/** The assessment, polled while AI evaluation is running. */
export function useAssessment(id: string) {
  return useQuery({
    queryKey: queryKeys.assessments.detail(id),
    queryFn: () => assessmentApi.get(id),
    enabled: useAuthed(),
    refetchInterval: (query) => (isProcessing(query.state.data) ? 3000 : false),
  });
}

export function useSectionContent(id: string, skill: AssessmentSkill) {
  return useQuery({
    queryKey: queryKeys.assessments.section(id, skill),
    queryFn: () => assessmentApi.section(id, skill),
    enabled: useAuthed(),
    staleTime: Infinity,
    retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
  });
}

export function useAssessmentResult(id: string) {
  return useQuery({
    queryKey: queryKeys.assessments.result(id),
    queryFn: () => assessmentApi.result(id),
    enabled: useAuthed(),
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2,
  });
}

function useAssessmentMutation<TVariables>(id: string, fn: (variables: TVariables) => Promise<Assessment>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (assessment) => {
      queryClient.setQueryData(queryKeys.assessments.detail(id), assessment);
      void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.state });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.assessments.detail(id) }),
  });
}

export function useStartSection(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skill: AssessmentSkill) => assessmentApi.startSection(id, skill),
    onSuccess: (content, skill) => {
      queryClient.setQueryData(queryKeys.assessments.section(id, skill), content);
      void queryClient.invalidateQueries({ queryKey: queryKeys.assessments.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.state });
    },
  });
}

export const useSubmitSection = (id: string) => useAssessmentMutation(id, (skill: AssessmentSkill) => assessmentApi.submit(id, skill));
export const useRetryEvaluation = (id: string) => useAssessmentMutation(id, (skill: AssessmentSkill) => assessmentApi.retry(id, skill));
export const useAbandonAssessment = (id: string) => useAssessmentMutation(id, () => assessmentApi.abandon(id));

export function useUploadRecording(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; blob: Blob; mimeType: string; durationMs: number }) => assessmentApi.uploadRecording(id, input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.assessments.section(id, "speaking") }),
  });
}

export function useCreateAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assessmentApi.create,
    onSuccess: (assessment) => {
      queryClient.setQueryData(queryKeys.assessments.detail(assessment.id), assessment);
      void queryClient.invalidateQueries({ queryKey: queryKeys.assessments.history });
    },
  });
}
