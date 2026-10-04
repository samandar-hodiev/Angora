import type { Timestamp, UUID } from "./api";

// ---- Progress & history ------------------------------------------------------------

export interface SkillProgress {
  code: string;
  name: string;
  /** 0–100 */
  score: number;
  xp: number;
  sessions: number;
  estimated_level: string | null;
  last_practiced_at: Timestamp | null;
}

export interface ProgressOverview {
  current_level: string | null;
  /** Latest estimate including "+", e.g. "B1+". */
  current_estimated_level: string | null;
  /** Practice minutes today in the learner's timezone. */
  today_minutes: number;
  target_level: string | null;
  daily_goal_minutes: number;
  overall_score: number | null;
  streak: { current_days: number; longest_days: number; last_activity_date: Timestamp | null };
  skills: SkillProgress[];
}

export type PracticeKind = "speaking" | "writing" | "reading" | "listening";

export interface HistoryItem {
  kind: PracticeKind;
  id: UUID;
  title: string;
  mode: string;
  status: string;
  score: number | null;
  created_at: Timestamp;
}

// ---- Mistakes ----------------------------------------------------------------------

export type Severity = "low" | "medium" | "high";

export interface Mistake {
  id: UUID;
  category: string;
  group: string;
  skill: string | null;
  original: string;
  correction: string;
  explanation: string;
  severity: Severity;
  source_type: string;
  created_at: Timestamp;
}

export interface MistakePattern {
  category: string;
  correction: string;
  example: string;
  explanation: string;
  occurrences: number;
  last_seen_at: Timestamp;
}

export interface Weakness {
  category: string;
  skill: string | null;
  severity_score: number;
  evidence_count: number;
  status: "active" | "improving" | "resolved";
  last_detected_at: Timestamp;
}

export interface MistakeSummary {
  total: number;
  groups: { group: string; count: number }[];
  patterns: MistakePattern[];
  weaknesses: Weakness[];
}

// ---- Vocabulary ----------------------------------------------------------------------
// Grammar has its own module: see ./grammar.

/** A published word as the learner browses the whole library. */
export interface LibraryWord {
  id: UUID;
  term: string;
  part_of_speech: string;
  pronunciation_ipa: string;
  /** How hard the word itself is. */
  level: string | null;
  tags: string[];
  translations: { uz?: string; ru?: string };
  level_content: Partial<Record<string, VocabularyLevelText>>;
  in_deck: boolean;
}

export interface VocabularyLibrary {
  items: LibraryWord[];
  /** The learner's level: the explanation the page opens on. */
  learner_level: string;
}

/** A word explained for one CEFR level. */
export interface VocabularyLevelText {
  definition: string;
  examples: string[];
  /** The lower level whose explanation this one shares; the text is the same. */
  same_as?: string;
}

export interface VocabularyCard {
  id: UUID;
  term: string;
  part_of_speech: string;
  definition: string;
  examples: string[];
  pronunciation_ipa: string;
  /** The word in the learner's own language. */
  translations?: { uz?: string; ru?: string };
  /** The word explained per CEFR level; empty for words written before levels existed. */
  level_content?: Partial<Record<string, VocabularyLevelText>>;
  level: string | null;
  tags: string[];
  status: "new" | "learning" | "reviewing" | "mastered";
  /** 0–100, computed by the API */
  mastery: number;
  due_at: Timestamp;
  last_reviewed_at: Timestamp | null;
}

export interface VocabularyDeck {
  summary: { total: number; due: number; new: number; learning: number; reviewing: number; mastered: number };
  cards: VocabularyCard[];
}

// ---- Personalization -----------------------------------------------------------------

export interface Recommendation {
  id: UUID;
  type: string;
  reason: string;
  priority: number;
  source: "rule" | "ai" | "teacher";
  content: { id: UUID; type: string; title: string; skill: string | null } | null;
  created_at: Timestamp;
  expires_at: Timestamp | null;
}

export interface LearningPlan {
  id: UUID;
  goal: string;
  target_level: string | null;
  starts_on: Timestamp;
  ends_on: Timestamp | null;
  plan: Record<string, unknown>;
  generated_by: "system" | "ai" | "teacher";
  updated_at: Timestamp;
  source_assessment_id: UUID | null;
  daily_minutes: number | null;
  level: string | null;
  items: import("./journey").LearningPlanItem[];
}

// ---- Content bodies (schema_version 1) -------------------------------------------------

export interface ChoiceQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export interface SpeakingTopicBody {
  prompt: string;
  guidance?: string[];
  preparation_seconds?: number;
  speaking_seconds?: number;
}

export interface WritingTaskBody {
  prompt: string;
  instructions?: string[];
  min_words?: number;
  recommended_minutes?: number;
}

export interface ReadingPassageBody {
  passage: string;
  estimated_minutes?: number;
  questions: ChoiceQuestion[];
}

export interface ListeningExerciseBody {
  audio_url: string | null;
  duration_seconds?: number;
  transcript?: string;
  questions: ChoiceQuestion[];
}
