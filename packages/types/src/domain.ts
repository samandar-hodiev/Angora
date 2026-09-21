import type { Timestamp, UUID } from "./api";

// ---- Identity ------------------------------------------------------------------

/** Roles are open-ended: new roles can be introduced by the backend without a client release. */
export type Role = "USER" | "ADMIN" | (string & {});

export type AccountStatus = "active" | "suspended" | "deleted";

export interface User {
  id: UUID;
  email: string;
  role: Role;
  status: AccountStatus;
  email_verified_at: Timestamp | null;
  last_login_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuthSession {
  access_token: string;
  access_token_expires_at: Timestamp;
  refresh_token: string;
  refresh_token_expires_at: Timestamp;
  token_type: "Bearer";
  user: User;
  /** True when this sign-in created the account (e.g. first Google sign-in): start onboarding. */
  is_new_user?: boolean;
}

/** What the web app's own session route returns: the refresh token stays in an httpOnly cookie. */
export type WebSession = Omit<AuthSession, "refresh_token">;

export type ClientPlatform = "web" | "ios" | "android";

// ---- Profile -------------------------------------------------------------------

export interface Profile {
  user_id: UUID;
  display_name: string;
  first_name: string;
  last_name: string;
  /** Path on the API origin (e.g. /api/v1/avatars/...), or null. */
  avatar_url: string | null;
  /** Background image for the app's main area (e.g. /api/v1/wallpapers/...), or null. */
  wallpaper_url: string | null;
  phone_country: string | null;
  /** E.164, e.g. +998901234567. */
  phone_number: string | null;
  profile_completed_at: Timestamp | null;
  native_language: string | null;
  timezone: string;
  current_level: string | null;
  target_level: string | null;
  learning_goals: string[];
  daily_goal_minutes: number;
  preferences: Record<string, unknown>;
  onboarding_completed_at: Timestamp | null;
  updated_at: Timestamp;
}

// ---- Learning catalogue --------------------------------------------------------

export interface Skill {
  id: UUID;
  code: string;
  name: string;
  description: string;
  sort_order: number;
}

export interface Level {
  id: UUID;
  code: string;
  name: string;
  rank: number;
  description: string;
}

export interface ContentSummary {
  id: UUID;
  type: string;
  title: string;
  skill: string | null;
  level: string | null;
  topic: string | null;
  exam: string | null;
  difficulty: number;
  tags: string[];
  published_at: Timestamp | null;
  updated_at: Timestamp;
}

export interface ContentItem<Body = Record<string, unknown>> extends ContentSummary {
  schema_version: number;
  body: Body;
}

// ---- Subscriptions -------------------------------------------------------------

export type EntitlementKind = "feature" | "limit";
export type LimitPeriod = "day" | "week" | "month" | "lifetime";

export interface PlanEntitlement {
  key: string;
  kind: EntitlementKind;
  description: string;
  limit: number | null;
  period: LimitPeriod | null;
}

export interface SubscriptionPlan {
  id: UUID;
  code: string;
  name: string;
  description: string;
  billing_interval: "none" | "month" | "year";
  price_cents: number;
  currency: string;
  /** Price in so'm. null means the plan is not sold through a so'm provider. */
  price_uzs: number | null;
  trial_days: number;
  is_default: boolean;
  entitlements: PlanEntitlement[];
}

/** One attempt to pay for one plan. */
export interface PaymentTransaction {
  id: UUID;
  plan_id: UUID;
  plan_code: string;
  plan_name: string;
  provider: string;
  status: "created" | "prepared" | "paid" | "canceled" | "failed";
  /** Minor units of `currency`: tiyin for UZS. */
  amount_minor: number;
  currency: string;
  error_note?: string;
  paid_at: Timestamp | null;
  created_at: Timestamp;
}

export interface PaymentMethods {
  provider: string | null;
  available: boolean;
}

export interface Checkout {
  transaction_id: UUID;
  provider: string;
  url: string;
  amount_minor: number;
  currency: string;
}

/** A message the platform sent to this learner. */
export interface Notification {
  id: UUID;
  type: string;
  channel: "in_app" | "push" | "email";
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Timestamp | null;
  created_at: Timestamp;
}

export interface NotificationPreferences {
  in_app: boolean;
  email: boolean;
  /** Template codes this learner has switched off individually. */
  muted: string[];
}

export interface LimitState {
  label: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  period: LimitPeriod;
  resets_at: Timestamp | null;
}

export interface Entitlements {
  plan_code: string;
  plan_name: string;
  status: "free" | "trialing" | "active" | "past_due";
  features: string[];
  limits: Record<string, LimitState>;
}

export interface Subscription {
  id: UUID;
  plan_id: UUID;
  status: string;
  provider: string;
  current_period_start: Timestamp;
  current_period_end: Timestamp | null;
  trial_ends_at: Timestamp | null;
  cancel_at_period_end: boolean;
}

export interface CurrentSubscription {
  subscription: Subscription | null;
  entitlements: Entitlements;
}

// ---- Jobs & AI results -----------------------------------------------------------

export type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed";

export interface JobState {
  id: UUID;
  type: string;
  status: JobStatus;
  attempts: number;
  error_code?: string;
  result?: Record<string, unknown>;
  updated_at: Timestamp;
}

export interface EvaluationMistake {
  category: string;
  original: string;
  correction: string;
  explanation: string;
  severity: "low" | "medium" | "high";
  span?: { start: number; end: number };
}

/** Versioned, machine-readable AI evaluation (schema_version "evaluation.v1"). */
export interface EvaluationResult {
  schema_version: string;
  model_version: string;
  prompt_version: string;
  rubric_version: string;
  analysis_version: string;
  score: number | null;
  scale: string;
  scores: Record<string, number>;
  mistakes: EvaluationMistake[];
  strengths: string[];
  recommendations: { type: string; target: string; reason: string }[];
}

// ---- Health ----------------------------------------------------------------------

export interface HealthReport {
  status: "ok" | "degraded";
  version: string;
  time: Timestamp;
  checks: Record<string, { status: "up" | "down"; latency_ms: number }>;
}

// ---- Progress forecast -------------------------------------------------------------------

export interface ForecastWeek {
  week_start: Timestamp;
  sessions: number;
  avg_score: number;
  minutes: number;
}

export interface ForecastSkill {
  skill: string;
  /** Points per week. Negative means the skill is going backwards. */
  trend_per_week: number;
  avg_score: number;
  sessions: number;
}

/**
 * When this learner reaches the next level, at the rate they are going.
 *
 * `available` is false whenever there is no honest answer — too little practice, a flat
 * trend, a trend going the wrong way, or a date so far out that a straight line through a
 * few weeks means nothing. `reason` says which.
 */
export interface ProgressForecast {
  available: boolean;
  reason?: "not_enough_practice" | "no_upward_trend" | "too_far_out" | "ready_now";
  current_level: string | null;
  target_level: string | null;
  next_level: string | null;
  current_score: number | null;
  trend_per_week: number;
  weeks_to_next_level: number | null;
  projected_date: Timestamp | null;
  /** R² of the fit: how well a straight line actually describes this learner. */
  confidence: number;
  weeks: ForecastWeek[];
  skills: ForecastSkill[];
  sessions: number;
  weekly_sessions: number;
  method: string;
}
