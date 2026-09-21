/** Display formatting for the Owner console. Locale-stable so SSR and CSR agree. */

import type { CEFRLevel, ContentLanguage, ContentStatus, HealthState, PlanCode, SkillKey } from "../types";

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatNumber = (value: number) => numberFormat.format(Math.round(value));
export const formatCompact = (value: number) => compactFormat.format(value);
export const formatCurrency = (cents: number) => currencyFormat.format(Math.round(cents / 100));
export const formatPercent = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

export function formatMetric(value: number, format: "number" | "percent" | "currency" | "compact"): string {
  if (format === "percent") return formatPercent(value);
  if (format === "currency") return formatCurrency(value);
  if (format === "compact") return formatCompact(value);
  return formatNumber(value);
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const longDateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatLongDate = (iso: string) => longDateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

/** "3 days ago" against the frozen mock today, so it never drifts between renders. */
export function formatRelative(iso: string, now: string): string {
  const minutes = Math.round((Date.parse(now) - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  // Floor, never round: an account that joined ten days ago must not report "11d ago".
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ---- Labels -------------------------------------------------------------------------------

export const planLabels: Record<PlanCode, string> = {
  free: "Free",
  premium: "Premium",
  unlimited: "Unlimited",
};

export const skillLabels: Record<SkillKey, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  speaking: "Speaking",
  writing: "Writing",
  reading: "Reading",
  listening: "Listening",
  ielts: "IELTS",
};

export const statusLabels: Record<ContentStatus, string> = {
  draft: "Draft",
  ai_generated: "AI generated",
  review: "Review",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

export const languageLabels: Record<ContentLanguage, string> = {
  uz: "UZ",
  en: "EN",
  ru: "RU",
};

export const languageNames: Record<ContentLanguage, string> = {
  uz: "Uzbek",
  en: "English",
  ru: "Russian",
};

export const healthLabels: Record<HealthState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  attention: "Needs attention",
  down: "Down",
};

export const levelOrder: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Limits read as numbers everywhere; `null` is unlimited and `0` is locked. */
export function formatLimit(limit: number | null, period: string): string {
  if (limit === null) return "Unlimited";
  if (limit === 0) return "Locked";
  return `${formatNumber(limit)} / ${period}`;
}
