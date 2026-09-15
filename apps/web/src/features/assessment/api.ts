import type {
  Assessment,
  AssessmentAnswer,
  AssessmentConfig,
  AssessmentHistoryItem,
  AssessmentResult,
  AssessmentSkill,
  SectionContent,
  SpeakingAttempt,
} from "@engora/types";

import { apiClient } from "@/lib/api";

/**
 * Placement assessment endpoints. The client sends only what the learner did (choices, text,
 * recordings); correctness, timing and scores are decided by the API.
 */
export const assessmentApi = {
  config: () => apiClient.get<AssessmentConfig>("/assessments/config"),
  history: () => apiClient.get<AssessmentHistoryItem[]>("/assessments"),
  create: (startLevel: string) => apiClient.post<Assessment>("/assessments", { start_level: startLevel }),
  get: (id: string) => apiClient.get<Assessment>(`/assessments/${id}`),
  section: (id: string, skill: AssessmentSkill) => apiClient.get<SectionContent>(`/assessments/${id}/sections/${skill}`),
  startSection: (id: string, skill: AssessmentSkill) => apiClient.post<SectionContent>(`/assessments/${id}/sections/${skill}/start`),
  saveAnswer: (id: string, skill: AssessmentSkill, itemId: string, response: Record<string, unknown>, timeSpentMs = 0) =>
    apiClient.put<AssessmentAnswer>(`/assessments/${id}/sections/${skill}/answers/${itemId}`, {
      response,
      time_spent_ms: Math.max(0, Math.round(timeSpentMs)),
    }),
  uploadRecording: (id: string, input: { itemId: string; blob: Blob; mimeType: string; durationMs: number }) => {
    const base = input.mimeType.split(";")[0] ?? "audio/webm";
    const extension = base.includes("mp4") ? ".m4a" : base.includes("ogg") ? ".ogg" : ".webm";
    const form = new FormData();
    form.append("item_id", input.itemId);
    form.append("duration_ms", String(Math.round(input.durationMs)));
    form.append("file", new File([input.blob], `answer${extension}`, { type: base }));
    return apiClient.postForm<SpeakingAttempt>(`/assessments/${id}/sections/speaking/recordings`, form);
  },
  submit: (id: string, skill: AssessmentSkill) => apiClient.post<Assessment>(`/assessments/${id}/sections/${skill}/submit`),
  retry: (id: string, skill: AssessmentSkill) => apiClient.post<Assessment>(`/assessments/${id}/sections/${skill}/retry`),
  abandon: (id: string) => apiClient.post<Assessment>(`/assessments/${id}/abandon`),
  result: (id: string) => apiClient.get<AssessmentResult>(`/assessments/${id}/result`),
  audio: (id: string, stimulusId: string) => apiClient.blob(`/assessments/${id}/stimuli/${stimulusId}/audio`),
};
