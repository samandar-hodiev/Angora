/**
 * Owner console contract.
 *
 * These types are the shape the future Go API will return, so the UI never has to change
 * when the mock service layer in ./services is swapped for real endpoints:
 *   - snake_case fields, like the rest of @engora/types (Go JSON tags)
 *   - ISO-8601 strings for every date
 *   - string unions for every status, never free text
 *   - stable ids; display names are never used as keys
 *
 * When the backend exists these move to packages/types/src/owner.ts unchanged.
 */

export type ISODate = string;
export type UUID = string;

export type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const cefrLevels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** The three plans the platform sells. `all` is a filter value, never a stored plan. */
export type PlanCode = "free" | "premium" | "unlimited";
export type PlanFilter = PlanCode | "all";
export const planCodes: PlanCode[] = ["free", "premium", "unlimited"];

export type ContentLanguage = "uz" | "en" | "ru";
export const contentLanguages: ContentLanguage[] = ["uz", "en", "ru"];

export type SkillKey =
  | "grammar"
  | "vocabulary"
  | "speaking"
  | "writing"
  | "reading"
  | "listening"
  | "ielts";

export const skillKeys: SkillKey[] = [
  "grammar",
  "vocabulary",
  "speaking",
  "writing",
  "reading",
  "listening",
  "ielts",
];

/** The editorial workflow, in order. `ai_generated` sits between draft and review. */
export type ContentStatus = "draft" | "ai_generated" | "review" | "approved" | "published" | "archived";
export const contentStatuses: ContentStatus[] = [
  "draft",
  "ai_generated",
  "review",
  "approved",
  "published",
  "archived",
];

export type ContentSource = "curated" | "ai" | "imported";

// ---- Analytics ---------------------------------------------------------------------------

export type RangeKey = "7d" | "30d" | "3m" | "6m" | "12m";
export const rangeKeys: RangeKey[] = ["7d", "30d", "3m", "6m", "12m"];

/** One day on the growth chart. Totals are cumulative; new_* are that day's arrivals. */
export interface LearnerGrowthPoint {
  date: ISODate;
  total: number;
  free: number;
  premium: number;
  unlimited: number;
  new_learners: number;
  new_free: number;
  new_premium: number;
  new_unlimited: number;
  active: number;
}

export interface LearnerGrowthSeries {
  range: RangeKey;
  from: ISODate;
  to: ISODate;
  /** Daily for short ranges, weekly buckets for long ones — the chart does not resample. */
  granularity: "day" | "week";
  points: LearnerGrowthPoint[];
}

export interface MetricDelta {
  /** Change against the previous period of the same length, in percent. */
  percent: number;
  direction: "up" | "down" | "flat";
  /** e.g. "vs previous 30 days" */
  comparison: string;
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  /** Rendering hint so the UI never guesses from the value. */
  format: "number" | "percent" | "currency" | "compact";
  hint: string;
  delta?: MetricDelta;
}

export interface DashboardMetrics {
  generated_at: ISODate;
  metrics: DashboardMetric[];
}

export interface PlanDistributionSlice {
  plan: PlanCode;
  learners: number;
  share: number;
  mrr_cents: number;
}

export interface ActivitySummary {
  active_today: number;
  active_week: number;
  active_month: number;
  total: number;
}

export interface ConversionSummary {
  period_label: string;
  free_to_premium: number;
  premium_to_unlimited: number;
  churned: number;
  conversion_rate: number;
  previous_conversion_rate: number;
}

export interface PlanChange {
  id: UUID;
  learner_id: UUID;
  learner_name: string;
  avatar_url: string | null;
  from_plan: PlanCode;
  to_plan: PlanCode;
  amount_cents: number;
  changed_at: ISODate;
}

export type ActivityKind =
  | "learner_registered"
  | "subscription_activated"
  | "content_published"
  | "content_updated"
  | "content_review"
  | "paywall_changed"
  | "wallpaper_enabled"
  | "settings_changed";

export interface ActivityEvent {
  id: UUID;
  kind: ActivityKind;
  message: string;
  detail?: string;
  actor: string;
  created_at: ISODate;
}

export type HealthState = "operational" | "degraded" | "attention" | "down";

export interface HealthCheck {
  key: string;
  label: string;
  state: HealthState;
  detail: string;
}

// ---- Content -----------------------------------------------------------------------------

export interface ContentStat {
  skill: SkillKey;
  label: string;
  total: number;
  published: number;
  draft: number;
  review: number;
  archived: number;
}

export interface ContentItem {
  id: UUID;
  title: string;
  slug: string;
  type: SkillKey;
  category: string;
  category_name: string;
  level: CEFRLevel;
  languages: ContentLanguage[];
  status: ContentStatus;
  source: ContentSource;
  author: string;
  updated_at: ISODate;
  published_at: ISODate | null;
}

export interface ContentQuery {
  search?: string;
  type?: SkillKey | "all";
  level?: CEFRLevel | "all";
  status?: ContentStatus | "all";
  language?: ContentLanguage | "all";
  source?: ContentSource | "all";
  sort?: "updated" | "title" | "status";
  page?: number;
  page_size?: number;
}

/** Mirrors the API's paginated envelope (see PageMeta in @engora/types). */
export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

// ---- Grammar CMS -------------------------------------------------------------------------

export type GrammarSectionKey =
  | "rule"
  | "formula"
  | "usage"
  | "examples"
  | "signal_words"
  | "common_mistakes"
  | "dont_forget"
  | "exceptions"
  | "tips"
  | "related";

export interface GrammarSectionMeta {
  key: GrammarSectionKey;
  label: string;
  /** What the section is for — shown to the Owner above the editor. */
  hint: string;
}

/** One editable block of a lesson. `body` is plain text; `items` carries list sections. */
export interface GrammarSection {
  key: GrammarSectionKey;
  body: string;
  items: string[];
  updated_at: ISODate;
}

export type LanguageStatus = "published" | "draft" | "missing";

/** The lesson in one language. Each language publishes on its own. */
export interface GrammarLocalizedContent {
  language: ContentLanguage;
  status: LanguageStatus;
  sections: GrammarSection[];
  updated_at: ISODate | null;
  updated_by: string | null;
}

/** A level-specific retelling of the same canonical rule. Generated, never hand-authored. */
export interface GrammarLevelAdaptation {
  level: CEFRLevel;
  summary: string;
  status: "generated" | "missing";
  generated_at: ISODate | null;
}

export interface GrammarTopicRow {
  id: UUID;
  slug: string;
  name: string;
  description: string;
  category: string;
  category_name: string;
  level: CEFRLevel;
  cefr_levels: CEFRLevel[];
  languages: Record<ContentLanguage, LanguageStatus>;
  status: ContentStatus;
  question_count: number;
  has_visual: boolean;
  has_ai_tutor: boolean;
  estimated_minutes: number;
  ielts_relevant: boolean;
  updated_at: ISODate;
  published_at: ISODate | null;
  author: string;
}

export interface GrammarTopicDetail extends GrammarTopicRow {
  keywords: string[];
  prerequisites: { slug: string; name: string }[];
  related: { slug: string; name: string }[];
  content: Record<ContentLanguage, GrammarLocalizedContent>;
  adaptations: GrammarLevelAdaptation[];
}

export interface GrammarTopicDraft {
  title: string;
  slug: string;
  category: string;
  level: CEFRLevel;
  estimated_minutes: number;
  description: string;
  keywords: string[];
  prerequisites: string[];
  related: string[];
  ielts_relevant: boolean;
}

export interface GrammarCategorySummary {
  slug: string;
  name: string;
  description: string;
  topics: number;
  published: number;
  draft: number;
  review: number;
}

// ---- Feature access (paywall) --------------------------------------------------------------

export type FeatureStatus = "free" | "premium" | "limited" | "disabled";

/** `null` means unlimited; `0` means locked. Matches LimitState.limit in @engora/types. */
export type FeatureLimit = number | null;

export interface FeatureAccess {
  key: string;
  name: string;
  description: string;
  category: SkillKey | "platform";
  status: FeatureStatus;
  free_limit: FeatureLimit;
  premium_limit: FeatureLimit;
  unlimited_limit: FeatureLimit;
  period: "day" | "week" | "month" | "lifetime";
  updated_at: ISODate;
}

// ---- Settings ----------------------------------------------------------------------------

export interface SiteSettings {
  general: {
    site_name: string;
    site_description: string;
    logo_url: string | null;
    support_email: string;
    timezone: string;
  };
  learner_defaults: {
    interface_language: ContentLanguage;
    explanation_language: ContentLanguage;
    theme: "system" | "light" | "dark";
    landing_page: "dashboard" | "learn" | "grammar";
    daily_goal_minutes: number;
    onboarding_placement_test: boolean;
  };
  features: {
    ai_coach_enabled: boolean;
    placement_test_enabled: boolean;
    leaderboard_enabled: boolean;
    public_registration: boolean;
  };
  maintenance: {
    enabled: boolean;
    message: string;
    allow_owner_access: boolean;
  };
  updated_at: ISODate;
}

export interface Wallpaper {
  id: string;
  name: string;
  /** A CSS background-image value — the same presets the learner Settings page renders. */
  preview: string;
  enabled: boolean;
  order: number;
  animated: boolean;
  usage_count: number;
}

// ---- Learners ----------------------------------------------------------------------------

export type LearnerStatus = "active" | "suspended" | "pending" | "archived";

export interface Learner {
  id: UUID;
  name: string;
  email: string;
  phone: string | null;
  age: number | null;
  avatar_url: string | null;
  level: CEFRLevel;
  plan: PlanCode;
  status: LearnerStatus;
  country: string;
  joined_at: ISODate;
  last_active_at: ISODate;
  streak_days: number;
  lessons_completed: number;
}

export interface LearnerQuery {
  search?: string;
  plan?: PlanFilter;
  level?: CEFRLevel | "all";
  status?: LearnerStatus | "all";
  sort?: "joined" | "last_active" | "name";
  page?: number;
  page_size?: number;
}

export interface SkillProgress {
  skill: SkillKey;
  label: string;
  /** 0–100. */
  mastery: number;
  level: CEFRLevel;
  sessions: number;
  last_activity_at: ISODate | null;
}

export interface LearnerWeakness {
  topic: string;
  skill: SkillKey;
  accuracy: number;
  attempts: number;
}

export interface LearnerSubscription {
  plan: PlanCode;
  status: "free" | "trialing" | "active" | "past_due" | "cancelled";
  started_at: ISODate;
  renews_at: ISODate | null;
  amount_cents: number;
  currency: string;
  provider: string;
  history: { id: UUID; from_plan: PlanCode; to_plan: PlanCode; changed_at: ISODate }[];
}

export interface LearnerActivity {
  id: UUID;
  kind: SkillKey | "auth" | "subscription";
  title: string;
  detail: string;
  created_at: ISODate;
}

export interface LearnerDetail extends Learner {
  skills: SkillProgress[];
  weaknesses: LearnerWeakness[];
  subscription: LearnerSubscription;
  activity: LearnerActivity[];
  goal: string;
  native_language: string;
  minutes_this_week: number;
  overall_mastery: number;
}
