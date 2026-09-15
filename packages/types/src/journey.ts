import type { Timestamp, UUID } from "./api";

/**
 * New-learner journey resources: email verification, onboarding state, CEFR level history,
 * placement assessments and structured plans. Mirrors apps/api/internal/{auth,onboarding,
 * levels,assessment,recommendations}; web and mobile use exactly these shapes.
 */

/** A CEFR code, optionally with "+", e.g. "B1" or "B1+". Always an estimate. */
export type CEFRCode = string;

// ---- Email verification --------------------------------------------------------------------

export interface EmailChallenge {
  email: string;
  code_length: number;
  expires_at: Timestamp;
  resend_available_at: Timestamp;
  /** Development only, when the API has no mail provider configured. */
  dev_code?: string;
}

// ---- Onboarding ------------------------------------------------------------------------------

export type OnboardingStep =
  | "NOT_STARTED"
  | "WELCOME"
  | "GOAL_SELECTION"
  | "DAILY_TIME"
  | "LEVEL_SELECTION"
  | "PLACEMENT_INTRO"
  | "PLACEMENT_START_LEVEL"
  | "PLACEMENT_READING"
  | "PLACEMENT_LISTENING"
  | "PLACEMENT_WRITING"
  | "PLACEMENT_SPEAKING"
  | "PLACEMENT_PROCESSING"
  | "PLACEMENT_RESULTS"
  | "PERSONALIZED_PLAN"
  | "COMPLETED";

export type LevelPath = "self_reported" | "placement";

export interface OnboardingOptions {
  goals: string[];
  max_goals: number;
  daily_minutes: number[];
  levels: string[];
}

export interface OnboardingState {
  step: OnboardingStep;
  profile_completed: boolean;
  level_path: LevelPath | null;
  assessment_id: UUID | null;
  goals: string[];
  daily_goal_minutes: number;
  self_reported_level: CEFRCode | null;
  placement_start_level: CEFRCode | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  updated_at: Timestamp;
  options: OnboardingOptions;
}

// ---- Levels ----------------------------------------------------------------------------------

export type LevelKind = "self_reported" | "placement_start" | "assessed" | "estimated";

export interface LevelEntry {
  kind: LevelKind;
  cefr: CEFRCode;
  source_type: "onboarding" | "assessment" | "practice" | "admin";
  source_id: UUID | null;
  confidence: number | null;
  created_at: Timestamp;
}

export interface LevelSummary {
  self_reported: LevelEntry | null;
  placement_start: LevelEntry | null;
  assessed: LevelEntry | null;
  current_estimated: LevelEntry | null;
  history: LevelEntry[];
}

// ---- Assessments -----------------------------------------------------------------------------

export type AssessmentSkill = "reading" | "listening" | "writing" | "speaking";
export type AssessmentStatus = "in_progress" | "processing" | "completed" | "failed" | "abandoned";
export type SectionStatus = "locked" | "available" | "in_progress" | "evaluating" | "completed" | "failed";
export type AssessmentItemType =
  | "multiple_choice"
  | "true_false_not_given"
  | "vocabulary_in_context"
  | "writing_task"
  | "speaking_task";

export interface AssessmentSectionConfig {
  skill: AssessmentSkill;
  time_limit_seconds: number;
  items: Record<string, number>;
  max_plays?: number;
  max_attempts?: number;
}

export interface AssessmentConfig {
  grace_seconds: number;
  sections: AssessmentSectionConfig[];
}

export interface AssessmentSection {
  skill: AssessmentSkill;
  position: number;
  status: SectionStatus;
  time_limit_seconds: number;
  item_count: number;
  answered_count: number;
  max_attempts?: number;
  max_plays?: number;
  started_at: Timestamp | null;
  deadline_at: Timestamp | null;
  submitted_at: Timestamp | null;
  completed_at: Timestamp | null;
  error_code?: string;
}

export interface Assessment {
  id: UUID;
  kind: "placement";
  status: AssessmentStatus;
  source: "onboarding" | "profile";
  start_level: CEFRCode;
  started_at: Timestamp;
  submitted_at: Timestamp | null;
  completed_at: Timestamp | null;
  abandoned_at: Timestamp | null;
  current_skill: AssessmentSkill | null;
  sections: AssessmentSection[];
  server_time: Timestamp;
}

export interface AssessmentOption {
  id: string;
  text: string;
}

export interface AssessmentStimulus {
  id: UUID;
  type: "reading_passage" | "listening_clip";
  title: string;
  passage?: string;
  has_audio: boolean;
  duration_ms?: number;
  /** Only present once the section is no longer in progress. */
  transcript?: string;
}

export interface AssessmentItem {
  id: UUID;
  position: number;
  type: AssessmentItemType;
  stimulus_id: UUID | null;
  prompt: string;
  options: AssessmentOption[];
  settings: {
    min_words?: number;
    max_words?: number;
    instructions?: string[];
    prep_seconds?: number;
    response_seconds?: number;
    guidance?: string[];
  };
}

export interface SpeakingAttempt {
  id: UUID;
  attempt_number: number;
  status: string;
  duration_ms: number | null;
  created_at: Timestamp;
}

export interface AssessmentAnswer {
  item_id: UUID;
  response: { option_id?: string; text?: string; speaking_session_id?: UUID };
  answered_at: Timestamp;
  attempts?: SpeakingAttempt[];
}

export interface SectionContent {
  assessment_id: UUID;
  section: AssessmentSection;
  stimuli: AssessmentStimulus[];
  items: AssessmentItem[];
  answers: AssessmentAnswer[];
  server_time: Timestamp;
}

/** A strength or focus area: a skill ("writing") or a criterion ("writing.grammar"). */
export interface AssessmentArea {
  type: "skill" | "criterion";
  code: string;
  score: number;
}

export interface AssessmentSkillResult {
  skill: AssessmentSkill;
  score: number;
  cefr: CEFRCode;
  confidence: number;
  subscores: Record<string, number>;
}

export interface AssessmentResult {
  assessment_id: UUID;
  kind: "placement";
  source: "onboarding" | "profile";
  start_level: CEFRCode;
  overall: { cefr: CEFRCode; score: number; confidence: number };
  skills: AssessmentSkillResult[];
  strengths: AssessmentArea[];
  focus_areas: AssessmentArea[];
  summary: { code: string; params: Record<string, string>; text: string };
  scoring_version: string;
  completed_at: Timestamp;
}

export interface AssessmentHistoryItem {
  id: UUID;
  kind: "placement";
  status: AssessmentStatus;
  source: "onboarding" | "profile";
  start_level: CEFRCode;
  overall_cefr: CEFRCode | null;
  overall_score: number | null;
  started_at: Timestamp;
  completed_at: Timestamp | null;
}

// ---- Plans -----------------------------------------------------------------------------------

export interface LearningPlanItem {
  id: UUID;
  position: number;
  skill: string;
  focus: string;
  activity_code: string;
  title: string;
  description: string;
  minutes: number;
  level: CEFRCode | null;
  reason_code: "weakness" | "goal" | "balance" | string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  content: { id: UUID; type: string; title: string; skill: string | null } | null;
}
