"use client";

import { apiClient } from "@/lib/api";

/**
 * Reading, listening and writing practice.
 *
 * Reading and listening are marked by the API against the stored answer key — the client
 * never sees it, and a score exists only once the attempt is submitted. Writing has no key,
 * so it is evaluated by the AI layer and the result comes back with the rubric scores.
 */

export type PracticeSkill = "reading" | "listening";

export interface PracticeSetRow {
  id: string;
  title: string;
  level: string | null;
  topic: string | null;
  difficulty: number;
  question_count: number;
  attempts: number;
  best_score: number | null;
}

export interface PracticeQuestion {
  id: string;
  type: string;
  position: number;
  prompt: string;
  options: { id: string; text: string }[];
}

export interface PracticeSet {
  id: string;
  title: string;
  level: string | null;
  difficulty: number;
  /** The passage, or the clip's transcript and audio, exactly as authored. */
  body: Record<string, unknown>;
  questions: PracticeQuestion[];
}

export interface PracticeAnswer {
  option_id?: string;
  text?: string;
}

export interface PracticeMark {
  question_id: string;
  correct: boolean;
  answered: boolean;
  given: PracticeAnswer;
  expected: PracticeAnswer & { accept?: string[] };
  explanation?: string;
  target?: string;
}

export interface PracticeAttempt {
  id: string;
  set_id: string;
  status: "in_progress" | "completed" | "abandoned";
  correct_count: number;
  total_count: number;
  score: number | null;
  started_at: string;
  completed_at: string | null;
  marks?: PracticeMark[];
}

export const practiceApi = {
  sets: (skill: PracticeSkill) => apiClient.getPage<PracticeSetRow>(`/${skill}/sets`, { query: { page_size: 50 } }),
  set: (skill: PracticeSkill, id: string) => apiClient.get<PracticeSet>(`/${skill}/sets/${id}`),
  start: (skill: PracticeSkill, setId: string) => apiClient.post<PracticeAttempt>(`/${skill}/sets/${setId}/attempts`),
  save: (skill: PracticeSkill, attemptId: string, answers: Record<string, PracticeAnswer>, timeSpentMs: number) =>
    apiClient.post<void>(`/${skill}/attempts/${attemptId}/answers`, { answers, time_spent_ms: timeSpentMs }),
  complete: (skill: PracticeSkill, attemptId: string, answers: Record<string, PracticeAnswer>, timeSpentMs: number) =>
    apiClient.post<PracticeAttempt>(`/${skill}/attempts/${attemptId}/complete`, { answers, time_spent_ms: timeSpentMs }),
  attempt: (skill: PracticeSkill, attemptId: string) => apiClient.get<PracticeAttempt>(`/${skill}/attempts/${attemptId}`),
};

// ---- Writing ---------------------------------------------------------------------------

export interface WritingTask {
  id: string;
  title: string;
  level: string | null;
  difficulty: number;
  body: { prompt?: string; instructions?: string[]; min_words?: number; recommended_minutes?: number };
}

export interface WritingFeedback {
  task_response: number;
  grammar: number;
  vocabulary: number;
  coherence: number;
  /** An AI estimate of the level this piece shows, not an exam result. */
  cefr_estimate: string;
  confidence: number;
  mistakes: { category: string; original: string; correction: string; explanation: string; severity: string }[];
}

export interface WritingSubmission {
  id: string;
  task_id: string | null;
  prompt: string;
  text: string;
  word_count: number;
  status: "draft" | "submitted" | "analyzing" | "completed" | "failed";
  overall_score: number | null;
  feedback?: WritingFeedback;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export const writingApi = {
  tasks: () => apiClient.getPage<WritingTask>("/writing/tasks", { query: { page_size: 50 } }),
  submit: (input: { task_id?: string; prompt?: string; text: string }) =>
    apiClient.post<WritingSubmission>("/writing/submissions", input),
  submissions: () => apiClient.getPage<WritingSubmission>("/writing/submissions", { query: { page_size: 20 } }),
};
