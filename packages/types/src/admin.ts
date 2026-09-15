import type { Timestamp, UUID } from "./api";

export interface AdminOverview {
  users: { total: number; active_30d: number; new_7d: number };
  plans: { plan_code: string; plan_name: string; is_default: boolean; users: number }[];
  mrr_cents: number;
  currency: string;
  ai: { cost_usd_30d: number; requests_30d: number; failed_30d: number };
  content: { status: string; count: number }[];
}

export interface AIUsageRow {
  key: string;
  provider?: string;
  model?: string;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  audio_seconds: number;
  cost_usd: number;
  avg_latency_ms: number;
}

export interface AIUsageReport {
  days: number;
  totals: AIUsageRow;
  by_task: AIUsageRow[];
  by_model: AIUsageRow[];
  daily: { date: Timestamp; cost_usd: number; requests: number }[];
}

export type ContentStatus = "draft" | "review" | "published" | "archived";

export interface AdminContentRow {
  id: UUID;
  type: string;
  title: string;
  skill: string | null;
  level: string | null;
  topic: string | null;
  exam: string | null;
  difficulty: number;
  status: ContentStatus;
  published_at: Timestamp | null;
  updated_at: Timestamp;
}
