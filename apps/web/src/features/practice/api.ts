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

// ---- Speaking --------------------------------------------------------------------------

export interface SpeakingFeedback {
  fluency: number;
  grammar: number;
  vocabulary: number;
  relevance: number;
  cefr_estimate: string;
  confidence: number;
  mistakes: { category: string; original: string; correction: string; explanation: string; severity: string }[];
}

export interface SpeakingSession {
  id: string;
  task_id: string | null;
  prompt: string;
  status: "in_progress" | "submitted" | "analyzing" | "completed" | "failed" | "abandoned";
  overall_score: number | null;
  duration_ms: number | null;
  transcript?: string;
  words_per_minute?: number;
  feedback?: SpeakingFeedback;
  created_at: string;
  completed_at: string | null;
}

export const speakingApi = {
  tasks: () => apiClient.getPage<WritingTask>("/speaking/tasks", { query: { page_size: 50 } }),
  sessions: () => apiClient.getPage<SpeakingSession>("/speaking/sessions", { query: { page_size: 20 } }),
  /** The recording goes up as multipart; the report comes back when all three stages finish. */
  submit: (input: { blob: Blob; mimeType: string; durationMs: number; taskId?: string }) => {
    const form = new FormData();
    // The filename's extension matters: the server checks the declared type against the bytes.
    const extension = input.mimeType.includes("ogg") ? "ogg" : input.mimeType.includes("mp4") ? "m4a" : "webm";
    form.append("audio", new File([input.blob], `answer.${extension}`, { type: input.mimeType }));
    form.append("duration_ms", String(Math.round(input.durationMs)));
    if (input.taskId) form.append("task_id", input.taskId);
    return apiClient.postForm<SpeakingSession>("/speaking/sessions", form);
  },
};

// ---- IELTS mock exam ---------------------------------------------------------------------

export type IELTSSkill = "listening" | "reading" | "writing" | "speaking";

export interface IELTSExamSection {
  skill: IELTSSkill;
  content_item_id: string | null;
  title?: string;
  time_limit_seconds: number;
}

export interface IELTSExam {
  id: string;
  slug: string;
  title: string;
  description: string;
  sections: IELTSExamSection[];
  status: string;
  total_minutes: number;
}

export interface IELTSSectionResult {
  correct?: number;
  total?: number;
  rubric_score?: number;
  band: number;
  submitted_at: string;
}

export interface IELTSAttempt {
  id: string;
  exam_id: string;
  exam_slug: string;
  status: "in_progress" | "completed" | "abandoned";
  sections: Partial<Record<IELTSSkill, IELTSSectionResult>>;
  overall_band: number | null;
  started_at: string;
  completed_at: string | null;
}

export const ieltsApi = {
  exams: () => apiClient.get<IELTSExam[]>("/ielts/exams"),
  attempts: () => apiClient.get<IELTSAttempt[]>("/ielts/attempts"),
  start: (slug: string) => apiClient.post<IELTSAttempt>(`/ielts/exams/${slug}/attempts`),
  submitSection: (attemptId: string, skill: IELTSSkill, body: { correct?: number; total?: number; rubric_score?: number; source_id?: string }) =>
    apiClient.post<IELTSAttempt>(`/ielts/attempts/${attemptId}/sections/${skill}`, body),
  complete: (attemptId: string) => apiClient.post<IELTSAttempt>(`/ielts/attempts/${attemptId}/complete`),
};

// ---- AI coach --------------------------------------------------------------------------

export interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface CoachConversation {
  id: string;
  title: string;
  status: "active" | "archived";
  messages?: CoachMessage[];
  updated_at: string;
  created_at: string;
}

export const coachApi = {
  conversations: () => apiClient.get<CoachConversation[]>("/coach/conversations"),
  conversation: (id: string) => apiClient.get<CoachConversation>(`/coach/conversations/${id}`),
  send: (input: { conversation_id?: string; message: string }) =>
    apiClient.post<CoachConversation>("/coach/messages", input),
};
