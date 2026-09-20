import type { Timestamp, UUID } from "./api";

/**
 * The grammar learning system's API contract, mirroring apps/api/internal/grammar.
 * The mobile apps will read the same resources.
 */

export type GrammarState = "not_started" | "learning" | "practicing" | "developing" | "mastered";

export type GrammarRelationKind =
  | "prerequisite"
  | "related"
  | "compare"
  | "next"
  | "alternative"
  | "commonly_confused";

export type GrammarQuestionType =
  | "multiple_choice"
  | "fill_blank"
  | "ordering"
  | "error_correction"
  | "transformation"
  | "matching"
  | "short_answer"
  | "free_writing"
  | "contextual";

export type GrammarPracticeMode = "learning" | "test";

export interface GrammarCategory {
  slug: string;
  name: string;
  description: string;
  sort_order: number;
  topic_count: number;
  started_count: number;
  mastered_count: number;
  /** 0–100 across the category's topics. */
  mastery: number;
  levels: string[];
}

export interface GrammarTopicSummary {
  slug: string;
  name: string;
  description: string;
  category: string;
  category_name: string;
  /** Band inside the category, e.g. "Present" under Tenses. Empty when ungrouped. */
  group: string;
  level: string | null;
  cefr_levels: string[];
  /** 0–1. */
  difficulty: number;
  ielts_relevant: boolean;
  estimated_minutes: number;
  has_practice: boolean;
  /** 0–100. */
  mastery: number;
  state: GrammarState;
  attempts: number;
  last_practiced_at: Timestamp | null;
}

export interface GrammarFormula {
  label: string;
  pattern: string;
  examples: string[];
}

export interface GrammarExample {
  text: string;
  note?: string;
}

export interface GrammarCommonMistake {
  wrong: string;
  right: string;
  why: string;
  /** Ties the mistake to the practice questions that test it. */
  rule?: string;
}

/** The canonical, curated explanation of a topic. Never generated at read time. */
export interface GrammarContent {
  intro: string;
  explanation: string;
  formulas: GrammarFormula[];
  usage: string[];
  signal_words: string[];
  examples: GrammarExample[];
  common_mistakes: GrammarCommonMistake[];
}

export interface GrammarRelatedTopic extends GrammarTopicSummary {
  kind: GrammarRelationKind;
  note?: string;
}

export interface GrammarProgress {
  mastery: number;
  understanding: number;
  practice: number;
  application: number;
  state: GrammarState;
  attempts: number;
  correct: number;
  last_practiced_at: Timestamp | null;
}

export interface GrammarVisual {
  id: UUID;
  kind: "timeline" | "flow" | "comparison_table" | "transformation" | "rule_diagram" | "concept_map";
  /** Path on the API origin; fetch it with the API client, not a bare <img src>. */
  url: string;
  alt_text: string;
  caption: string;
  status: "pending" | "ready" | "failed";
}

export interface GrammarTopic extends GrammarTopicSummary {
  content: GrammarContent | null;
  prerequisites: GrammarRelatedTopic[];
  related: GrammarRelatedTopic[];
  compare: GrammarRelatedTopic[];
  next: GrammarRelatedTopic[];
  progress: GrammarProgress;
  question_count: number;
  visuals: GrammarVisual[];
}

export interface GrammarComparisonRow {
  aspect: string;
  left: string;
  right: string;
}

export interface GrammarComparison {
  left: GrammarTopicSummary;
  right: GrammarTopicSummary;
  summary: string;
  rows: GrammarComparisonRow[];
}

export interface GrammarSearchResult extends GrammarTopicSummary {
  /** The topic's own keywords that matched, for highlighting. */
  matched_keywords: string[];
  rank: number;
}

export interface GrammarSearchResponse {
  query: string;
  results: GrammarSearchResult[];
  /** Topics connected to the results that did not match the query themselves. */
  related: GrammarTopicSummary[];
  /** Offered when nothing matched, so the empty state is never a dead end. */
  suggestions: string[];
}

export interface GrammarMapGroup {
  label: string;
  topics: GrammarTopicSummary[];
}

export interface GrammarMapNode {
  slug: string;
  name: string;
  groups: GrammarMapGroup[];
}

export interface GrammarSuggestion {
  kind: "practice_rule" | "compare" | "continue" | "weak" | "start";
  topic: string;
  topic_name: string;
  rule?: string;
  label: string;
  reason: string;
  mastery: number;
  priority: number;
}

export interface GrammarStats {
  topics_total: number;
  topics_started: number;
  topics_mastered: number;
  overall_mastery: number;
}

export interface GrammarOverview {
  recommended: GrammarSuggestion[];
  continue: GrammarTopicSummary[];
  weak: GrammarTopicSummary[];
  summary: GrammarStats;
}

export interface GrammarCategoryProgress {
  slug: string;
  name: string;
  mastery: number;
  total: number;
  started: number;
  mastered: number;
}

export interface GrammarProgressOverview {
  overall: number;
  categories: GrammarCategoryProgress[];
  stats: GrammarStats;
  weakest: GrammarTopicSummary[];
}

// ---- Practice ------------------------------------------------------------------------

export interface GrammarQuestionPayload {
  options?: string[];
  segments?: string[];
  hint?: string;
  sentence?: string;
  instruction?: string;
  left?: string[];
  right?: string[];
  min_words?: number;
  max_words?: number;
}

export interface GrammarQuestion {
  id: UUID;
  type: GrammarQuestionType;
  level: string | null;
  difficulty: number;
  prompt: string;
  payload: GrammarQuestionPayload;
  /** Present in learning mode only; test mode withholds it until the end. */
  explanation?: string;
  target_rule: string;
  tags: string[];
}

export interface GrammarAttempt {
  id: UUID;
  topic: string;
  topic_name: string;
  mode: GrammarPracticeMode;
  status: "in_progress" | "completed" | "abandoned";
  total: number;
  answered: number;
  questions: GrammarQuestion[];
  started_at: Timestamp;
}

export interface GrammarResponse {
  index?: number;
  text?: string;
  order?: string[];
  /** Left index (as a string key) → right index. */
  pairs?: Record<string, number>;
}

export interface GrammarWritingCorrection {
  wrong: string;
  right: string;
  why: string;
  kind: "target_grammar" | "grammar" | "vocabulary" | "spelling" | "style";
}

export interface GrammarFeedback {
  recorded: boolean;
  /** null in test mode: the answer is stored but nothing is revealed until the end. */
  correct: boolean | null;
  score: number | null;
  expected?: string;
  explanation?: string;
  rule?: string;
  corrections?: GrammarWritingCorrection[];
  /** The answer was saved but could not be analysed right now. */
  ai_unavailable?: boolean;
}

export interface GrammarAccuracy {
  key: string;
  label: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface GrammarMastery {
  mastery: number;
  understanding: number;
  practice: number;
  application: number;
  state: GrammarState;
}

export interface GrammarReviewItem {
  question_id: UUID;
  prompt: string;
  correct: boolean;
  expected?: string;
  explanation?: string;
  rule?: string;
  response: GrammarResponse;
}

export interface GrammarNextStep {
  kind: "practice_rule" | "next_topic" | "apply_writing" | "apply_speaking";
  topic?: string;
  rule?: string;
  label: string;
  reason: string;
}

export interface GrammarResult {
  attempt_id: UUID;
  topic: string;
  topic_name: string;
  mode: GrammarPracticeMode;
  score: number;
  correct: number;
  total: number;
  by_rule: GrammarAccuracy[];
  by_type: GrammarAccuracy[];
  by_difficulty: GrammarAccuracy[];
  weaknesses: string[];
  mastery: GrammarMastery;
  review: GrammarReviewItem[];
  next: GrammarNextStep | null;
}

// ---- AI ------------------------------------------------------------------------------

export interface GrammarAIFormula {
  label: string;
  pattern: string;
  example: string;
}

export interface GrammarAICorrection {
  wrong: string;
  right: string;
  why: string;
}

export interface GrammarMiniCheck {
  question: string;
  options: string[];
  answer: number;
}

export interface GrammarExplanation {
  definition: string;
  when_to_use: string[];
  formulas: GrammarAIFormula[];
  positive: string[];
  negative: string[];
  questions: string[];
  common_mistakes: GrammarAICorrection[];
  mini_check?: GrammarMiniCheck | null;
}

export interface GrammarExplanationResponse {
  topic: string;
  level: string;
  language: string;
  explanation: GrammarExplanation;
  /** Served from the shared cache rather than generated for this request. */
  cached: boolean;
}

export interface GrammarTutorReply {
  topic: string;
  answer: string;
}
