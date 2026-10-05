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
  streak: {
    current_days: number;
    longest_days: number;
    last_activity_date: Timestamp | null;
  };
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

/** word: a single word; phrase: phrasal verb, idiom, fixed phrase; collocation: words that go together. */
export type LexiconKind = "word" | "phrase" | "collocation";

/** Another meaning of an entry, at the level a learner meets it. */
export interface WordSense {
  definition: string;
  level: string;
  example: string;
}

/** list: from a level word list; ai_checked: confirmed by a second check; ai: unverified; curated: set by an editor. */
export type LevelSource = "list" | "ai_checked" | "ai" | "curated";

/** A word's status in the learner's own deck. */
export type DeckStatus = "new" | "learning" | "reviewing" | "mastered";

/** A published word as the learner browses the whole library. */
export interface LibraryWord {
  id: UUID;
  term: string;
  kind: LexiconKind;
  part_of_speech: string;
  pronunciation_ipa: string;
  /** How hard the word itself is. */
  level: string | null;
  tags: string[];
  translations: { uz?: string; ru?: string; ru_pron?: string };
  level_content: Partial<Record<string, VocabularyLevelText>>;
  /** The explanation at the entry's own level. */
  definition: string;
  examples: string[];
  /** Other meanings, each at its own level. */
  senses: WordSense[];
  level_source: LevelSource;
  /** neutral | formal | informal | …; empty when not known yet. */
  register: string;
  /** Near-synonyms: the words worth comparing it with. */
  synonyms: string[];
  in_deck: boolean;
  deck_status: DeckStatus | null;
}

/** One value a library filter can take, with how many words have it. */
export interface VocabularyFacet {
  value: string;
  count: number;
}

export interface VocabularyLibrary {
  items: LibraryWord[];
  /** The learner's level: the explanation the page opens on. */
  learner_level: string;
  facets: {
    levels: VocabularyFacet[];
    topics: VocabularyFacet[];
    parts_of_speech: VocabularyFacet[];
    registers: VocabularyFacet[];
  };
}

export interface VocabularyLibraryQuery {
  page: number;
  q: string;
  level: string;
  topic: string;
  pos: string;
  kind: LexiconKind;
  register: string;
  sort: "level" | "az" | "newest";
  show: "all" | "new" | "mine";
}

/** A word explained for one CEFR level. */
export interface VocabularyLevelText {
  definition: string;
  examples: string[];
  /** The lower level whose explanation this one shares; the text is the same. */
  same_as?: string;
}

/** How a word is used, beyond what it means. */
export interface WordUsage {
  usage_note: string;
  register: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  word_family: string[];
  /** The mistake an Uzbek or Russian speaker typically makes with it. */
  common_mistake: string;
}

/** A word named on another word's page; id is set when it is in the library. */
export interface RelatedWord {
  term: string;
  id: UUID | null;
  level: string | null;
  uz?: string;
}

/** Everything about one word. */
export interface WordDetail extends Omit<LibraryWord, "synonyms"> {
  usage: WordUsage;
  synonyms: RelatedWord[];
  antonyms: RelatedWord[];
  same_topic: RelatedWord[];
  deck: {
    status: DeckStatus;
    mastery: number;
    due_at: Timestamp;
    last_reviewed_at: Timestamp | null;
    reviews: number;
  } | null;
  learner_level: string;
}

export interface ComparedWord {
  term: string;
  part_of_speech: string;
  meaning: string;
  when_to_use: string;
  register: string;
  collocations: string[];
  examples: string[];
  translations: { uz?: string; ru?: string };
}

/** "What is the difference between job and occupation?" */
export interface WordComparison {
  verdict: string;
  interchangeable: "never" | "sometimes" | "often";
  words: ComparedWord[];
  /** Each aspect has one point per word, in the order of words. */
  differences: { aspect: string; points: string[] }[];
  tip: string;
  native_note: { uz?: string; ru?: string };
  quiz: { sentence: string; answer: string; explanation: string }[];
}

export interface ComparisonResponse {
  terms: string[];
  level: string;
  comparison: WordComparison;
  /** Words of the comparison that are in the library, by lower-case term. */
  library: Record<string, UUID>;
  cached: boolean;
}

export interface VocabularyCard {
  id: UUID;
  term: string;
  part_of_speech: string;
  definition: string;
  examples: string[];
  pronunciation_ipa: string;
  /** The word in the learner's own language. */
  translations?: { uz?: string; ru?: string; ru_pron?: string };
  /** The word explained per CEFR level; empty for words written before levels existed. */
  level_content?: Partial<Record<string, VocabularyLevelText>>;
  level: string | null;
  tags: string[];
  collocations?: string[];
  kind?: LexiconKind;
  status: DeckStatus;
  /** 0–100, computed by the API */
  mastery: number;
  due_at: Timestamp;
  last_reviewed_at: Timestamp | null;
}

/** One meaning of a word, climbed level by level; an empty term means no word of its own there. */
export interface LevelLadder {
  term: string;
  meaning_uz: string;
  summary_uz: string;
  rungs: { level: string; term: string; register: string; nuance_uz: string; example: string }[];
}

export interface LadderResponse {
  ladder: LevelLadder;
  /** Rung words in the library, by lower-case term. */
  library: Record<string, UUID>;
  cached: boolean;
}

export interface VocabularyDeck {
  summary: {
    total: number;
    due: number;
    new: number;
    learning: number;
    reviewing: number;
    mastered: number;
    reviewed_today: number;
  };
  cards: VocabularyCard[];
  /** The learner's level: the explanation each card shows. */
  learner_level: string;
}

export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface ReviewQueue {
  cards: VocabularyCard[];
  remaining: number;
}

export interface ReviewResult {
  status: DeckStatus;
  mastery: number;
  interval_days: number;
  due_at: Timestamp;
}

// ---- Personalization -----------------------------------------------------------------

export interface Recommendation {
  id: UUID;
  type: string;
  reason: string;
  priority: number;
  source: "rule" | "ai" | "teacher";
  content: {
    id: UUID;
    type: string;
    title: string;
    skill: string | null;
  } | null;
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
