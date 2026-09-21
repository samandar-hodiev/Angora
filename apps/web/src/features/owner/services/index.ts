/**
 * Owner service layer — the only place the console talks to "the backend".
 *
 * Every function here is async and shaped like the endpoint that will replace it:
 *
 *   getDashboardMetrics()   → GET  /api/v1/owner/dashboard
 *   getLearnerGrowth()      → GET  /api/v1/owner/analytics/growth?range=30d&plan=premium
 *   getContent()            → GET  /api/v1/owner/content?status=review&page=2
 *   getGrammarTopic()       → GET  /api/v1/owner/grammar/:slug
 *   publishGrammarTopic()   → POST /api/v1/owner/grammar/:slug/publish
 *   getLearners()           → GET  /api/v1/owner/learners
 *   updateFeatureAccess()   → PATCH /api/v1/owner/paywall/:key
 *   …
 *
 * Filtering, sorting and pagination all happen here rather than in components, so moving them
 * to the server later is a change to this file alone.
 */

import type {
  ActivityEvent,
  ActivitySummary,
  ContentItem,
  ContentQuery,
  ContentStat,
  ContentStatus,
  ConversionSummary,
  DashboardMetric,
  DashboardMetrics,
  FeatureAccess,
  GrammarCategorySummary,
  GrammarSectionKey,
  GrammarTopicDetail,
  GrammarTopicDraft,
  GrammarTopicRow,
  HealthCheck,
  Learner,
  LearnerDetail,
  LearnerGrowthSeries,
  LearnerQuery,
  LearnerStatus,
  Paged,
  PlanChange,
  PlanCode,
  PlanDistributionSlice,
  PlanFilter,
  RangeKey,
  SiteSettings,
  Wallpaper,
  ContentLanguage,
} from "../types";
import {
  activityFeed,
  bucketWeekly,
  conversionSummary,
  generatedAt,
  healthChecks,
  latestPoint,
  mrrCents,
  planDistribution,
  recentConversions,
  todayTotals,
  windowOf,
} from "../data/analytics";
import { contentStats } from "../data/content";
import { buildGrammarDetail, generationSteps, grammarCategorySummaries } from "../data/grammar";
import { buildLearnerDetail } from "../data/learners";
import { MOCK_TODAY, delay, mockId, rangeDays, timestampOffset } from "../lib/mock";
import { store } from "./store";

const DEFAULT_PAGE_SIZE = 20;

function paginate<T>(items: T[], page = 1, pageSize = DEFAULT_PAGE_SIZE): Paged<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, page_size: pageSize, total, total_pages: totalPages };
}

const matches = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Writes replace records rather than editing them in place.
 *
 * A real API returns a fresh document on every read, and the cache above these functions
 * relies on that: a record mutated in place is reference-equal to the one React Query already
 * holds, so nothing re-renders. Keeping the mock honest about immutability keeps the UI honest.
 */
function replaceIn<T>(items: T[], match: (item: T) => boolean, patch: (item: T) => T): T | undefined {
  const index = items.findIndex(match);
  if (index < 0) return undefined;
  const updated = patch(items[index]!);
  items[index] = updated;
  return updated;
}

// ---- Dashboard ------------------------------------------------------------------------------

function deltaOf(current: number, previous: number, comparison: string) {
  if (previous === 0) return { percent: 0, direction: "flat" as const, comparison };
  const percent = ((current - previous) / previous) * 100;
  return {
    percent: Math.round(percent * 10) / 10,
    direction: percent > 0.5 ? ("up" as const) : percent < -0.5 ? ("down" as const) : ("flat" as const),
    comparison,
  };
}

export async function getDashboardMetrics(plan: PlanFilter = "all"): Promise<DashboardMetrics> {
  const last30 = windowOf(30);
  const previous30 = windowOf(60).slice(0, 30);
  const sumNew = (points: typeof last30, key: "new_learners" | "new_free" | "new_premium" | "new_unlimited") =>
    points.reduce((total, point) => total + point[key], 0);

  const newKey =
    plan === "free" ? "new_free" : plan === "premium" ? "new_premium" : plan === "unlimited" ? "new_unlimited" : "new_learners";
  const newCurrent = sumNew(last30, newKey);
  const newPrevious = sumNew(previous30, newKey);

  const paying = todayTotals.premium + todayTotals.unlimited;
  const conversion = (paying / latestPoint.total) * 100;

  const metrics: DashboardMetric[] = [
    {
      key: "learners_total",
      label: "Total learners",
      value: latestPoint.total,
      format: "number",
      hint: `${todayTotals.free.toLocaleString("en-US")} free · ${paying.toLocaleString("en-US")} paying`,
      delta: deltaOf(latestPoint.total, windowOf(31)[0]!.total, "vs 30 days ago"),
    },
    {
      key: "learners_free",
      label: "Free learners",
      value: todayTotals.free,
      format: "number",
      hint: `${Math.round((todayTotals.free / latestPoint.total) * 100)}% of all accounts`,
      delta: deltaOf(todayTotals.free, windowOf(31)[0]!.free, "vs 30 days ago"),
    },
    {
      key: "learners_premium",
      label: "Premium learners",
      value: todayTotals.premium,
      format: "number",
      hint: "$12 / month plan",
      delta: deltaOf(todayTotals.premium, windowOf(31)[0]!.premium, "vs 30 days ago"),
    },
    {
      key: "learners_unlimited",
      label: "Unlimited learners",
      value: todayTotals.unlimited,
      format: "number",
      hint: "$29 / month plan",
      delta: deltaOf(todayTotals.unlimited, windowOf(31)[0]!.unlimited, "vs 30 days ago"),
    },
    {
      key: "active_learners",
      label: "Active learners",
      value: latestPoint.active,
      format: "number",
      hint: "Opened a lesson in the last 30 days",
      delta: deltaOf(latestPoint.active, previous30[previous30.length - 1]!.active, "vs previous 30 days"),
    },
    {
      key: "new_learners",
      label: plan === "all" ? "New learners" : `New ${plan} learners`,
      value: newCurrent,
      format: "number",
      hint: "Registered in the last 30 days",
      delta: deltaOf(newCurrent, newPrevious, "vs previous 30 days"),
    },
    {
      key: "conversion_rate",
      label: "Conversion rate",
      value: Math.round(conversion * 10) / 10,
      format: "percent",
      hint: "Accounts on a paid plan",
      delta: deltaOf(conversionSummary.conversion_rate, conversionSummary.previous_conversion_rate, "vs last month"),
    },
    {
      key: "mrr",
      label: "Monthly revenue",
      value: mrrCents,
      format: "currency",
      hint: "Recurring, before refunds",
      delta: deltaOf(mrrCents, mrrCents * 0.91, "vs last month"),
    },
    {
      key: "content_published",
      label: "Content published",
      value: contentStats.reduce((total, stat) => total + stat.published, 0),
      format: "number",
      hint: `${contentStats.reduce((t, s) => t + s.review, 0)} items waiting in review`,
    },
    {
      key: "ai_usage",
      label: "AI requests",
      value: 184_320,
      format: "compact",
      hint: "Last 30 days · $612 estimated cost",
      delta: deltaOf(184_320, 162_500, "vs previous 30 days"),
    },
  ];

  return delay({ generated_at: generatedAt, metrics });
}

export async function getLearnerGrowth(range: RangeKey = "30d"): Promise<LearnerGrowthSeries> {
  const days = rangeDays[range];
  const points = windowOf(days);
  const granularity = days > 90 ? "week" : "day";
  const shaped = granularity === "week" ? bucketWeekly(points) : points;
  return delay({
    range,
    from: shaped[0]!.date,
    to: shaped[shaped.length - 1]!.date,
    granularity,
    points: shaped,
  });
}

export async function getPlanDistribution(): Promise<PlanDistributionSlice[]> {
  return delay(planDistribution);
}

export async function getActivitySummary(): Promise<ActivitySummary> {
  // Nested windows: whoever was active today was active this week and this month, so the three
  // numbers are derived from one another rather than measured separately.
  const month = latestPoint.active;
  return delay({
    active_today: Math.round(month * 0.28),
    active_week: Math.round(month * 0.64),
    active_month: month,
    total: latestPoint.total,
  });
}

export async function getConversionSummary(): Promise<ConversionSummary> {
  return delay(conversionSummary);
}

export async function getRecentLearners(limit = 6): Promise<Learner[]> {
  const items = [...store.learners].sort((a, b) => b.joined_at.localeCompare(a.joined_at)).slice(0, limit);
  return delay(items);
}

export async function getRecentConversions(limit = 6): Promise<PlanChange[]> {
  return delay(recentConversions.slice(0, limit));
}

export async function getContentStats(): Promise<ContentStat[]> {
  return delay(contentStats);
}

export async function getActivityFeed(limit = 8): Promise<ActivityEvent[]> {
  return delay(activityFeed.slice(0, limit));
}

export async function getHealthChecks(): Promise<HealthCheck[]> {
  return delay(healthChecks);
}

// ---- Content ---------------------------------------------------------------------------------

export async function getContent(query: ContentQuery = {}): Promise<Paged<ContentItem>> {
  const { search, type, level, status, language, source, sort = "updated", page = 1, page_size } = query;
  let items = store.content;

  if (search) items = items.filter((item) => matches(item.title, search) || matches(item.slug, search));
  if (type && type !== "all") items = items.filter((item) => item.type === type);
  if (level && level !== "all") items = items.filter((item) => item.level === level);
  if (status && status !== "all") items = items.filter((item) => item.status === status);
  if (language && language !== "all") items = items.filter((item) => item.languages.includes(language));
  if (source && source !== "all") items = items.filter((item) => item.source === source);

  const sorted = [...items].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "status") return a.status.localeCompare(b.status) || a.title.localeCompare(b.title);
    return b.updated_at.localeCompare(a.updated_at);
  });

  return delay(paginate(sorted, page, page_size));
}

export async function updateContentStatus(id: string, status: ContentStatus): Promise<ContentItem> {
  const now = timestampOffset(0, 12, 0);
  const item = replaceIn(
    store.content,
    (entry) => entry.id === id,
    (entry) => ({
      ...entry,
      status,
      updated_at: now,
      published_at: status === "published" ? now : entry.published_at,
    }),
  );
  if (!item) throw new Error("Content not found");

  // Grammar rows and their detail live in their own tables; keep all three in step.
  const topic = replaceIn(
    store.grammar,
    (entry) => entry.id === id,
    (entry) => ({ ...entry, status, updated_at: now, published_at: status === "published" ? now : entry.published_at }),
  );
  if (topic) store.grammarDetails.delete(topic.slug);
  return delay(item, 260);
}

// ---- Grammar CMS --------------------------------------------------------------------------

export interface GrammarQuery {
  search?: string;
  category?: string | "all";
  level?: string | "all";
  status?: ContentStatus | "all";
  language?: ContentLanguage | "all";
  sort?: "updated" | "name" | "level";
  page?: number;
  page_size?: number;
}

export async function getGrammarCategories(): Promise<GrammarCategorySummary[]> {
  const summaries = grammarCategorySummaries.map((category) => {
    const topics = store.grammar.filter((topic) => topic.category === category.slug);
    return {
      ...category,
      published: topics.filter((t) => t.status === "published").length,
      draft: topics.filter((t) => t.status === "draft").length,
      review: topics.filter((t) => t.status === "review").length,
    };
  });
  return delay(summaries);
}

export async function getGrammarTopics(query: GrammarQuery = {}): Promise<Paged<GrammarTopicRow>> {
  const { search, category, level, status, language, sort = "updated", page = 1, page_size } = query;
  let items = store.grammar;

  if (search) items = items.filter((topic) => matches(topic.name, search) || matches(topic.slug, search));
  if (category && category !== "all") items = items.filter((topic) => topic.category === category);
  if (level && level !== "all") items = items.filter((topic) => topic.level === level);
  if (status && status !== "all") items = items.filter((topic) => topic.status === status);
  if (language && language !== "all") items = items.filter((topic) => topic.languages[language] === "published");

  const sorted = [...items].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "level") return a.level.localeCompare(b.level) || a.name.localeCompare(b.name);
    return b.updated_at.localeCompare(a.updated_at);
  });

  return delay(paginate(sorted, page, page_size));
}

function detailOf(slug: string): GrammarTopicDetail {
  const cached = store.grammarDetails.get(slug);
  if (cached) return cached;
  const row = store.grammar.find((topic) => topic.slug === slug);
  if (!row) throw new Error(`Grammar topic "${slug}" not found`);
  const detail = buildGrammarDetail(row);
  store.grammarDetails.set(slug, detail);
  return detail;
}

export async function getGrammarTopic(slug: string): Promise<GrammarTopicDetail> {
  return delay(detailOf(slug));
}

export async function saveGrammarSection(input: {
  slug: string;
  language: ContentLanguage;
  section: GrammarSectionKey;
  body: string;
  items: string[];
}): Promise<GrammarTopicDetail> {
  const current = detailOf(input.slug);
  const now = timestampOffset(0, 12, 0);
  const localized = current.content[input.language];
  const exists = localized.sections.some((entry) => entry.key === input.section);
  const sections = exists
    ? localized.sections.map((entry) =>
        entry.key === input.section ? { ...entry, body: input.body, items: input.items, updated_at: now } : entry,
      )
    : [...localized.sections, { key: input.section, body: input.body, items: input.items, updated_at: now }];

  const detail: GrammarTopicDetail = {
    ...current,
    updated_at: now,
    content: {
      ...current.content,
      [input.language]: {
        ...localized,
        sections,
        status: localized.status === "missing" ? "draft" : localized.status,
        updated_at: now,
        updated_by: "You",
      },
    },
  };
  store.grammarDetails.set(input.slug, detail);
  replaceIn(store.grammar, (topic) => topic.slug === input.slug, (topic) => ({ ...topic, updated_at: now }));
  return delay(detail, 320);
}

/**
 * Mock AI generation. Reports progress step by step so the Owner UI can show what is being
 * written; no model is called and nothing leaves the browser.
 */
export async function generateGrammarContent(input: {
  slug: string;
  languages?: ContentLanguage[];
  onStep?: (step: { key: string; label: string; index: number; total: number }) => void;
  signal?: AbortSignal;
}): Promise<GrammarTopicDetail> {
  const total = generationSteps.length;
  for (let index = 0; index < total; index += 1) {
    if (input.signal?.aborted) throw new Error("Generation cancelled");
    await new Promise((resolve) => setTimeout(resolve, 420));
    input.onStep?.({ ...generationSteps[index]!, index, total });
  }

  const current = detailOf(input.slug);
  const now = timestampOffset(0, 12, 0);
  const languages = input.languages ?? (["uz", "en", "ru"] as ContentLanguage[]);

  const content = { ...current.content };
  const languageStates = { ...current.languages };
  for (const language of languages) {
    const fresh = buildGrammarDetail({ ...current, languages: { ...current.languages, [language]: "draft" } });
    content[language] = { ...fresh.content[language], status: "draft", updated_at: now, updated_by: "AI draft" };
    languageStates[language] = "draft";
  }

  const detail: GrammarTopicDetail = {
    ...current,
    content,
    languages: languageStates,
    status: "ai_generated",
    updated_at: now,
    author: "AI draft",
  };
  store.grammarDetails.set(input.slug, detail);
  replaceIn(
    store.grammar,
    (topic) => topic.slug === input.slug,
    (topic) => ({
      ...topic,
      status: "ai_generated" as ContentStatus,
      updated_at: now,
      author: "AI draft",
      languages: languageStates,
    }),
  );
  replaceIn(
    store.content,
    (entry) => entry.slug === input.slug && entry.type === "grammar",
    (entry) => ({
      ...entry,
      status: "ai_generated" as ContentStatus,
      updated_at: now,
      author: "AI draft",
      source: "ai" as const,
    }),
  );
  return detail;
}

export async function setGrammarStatus(slug: string, status: ContentStatus): Promise<GrammarTopicDetail> {
  const current = detailOf(slug);
  const now = timestampOffset(0, 12, 0);

  // Publishing a topic publishes every language draft with it; that is what the Owner just
  // confirmed in the dialog, and a half-published lesson is not a state learners should meet.
  const publishing = status === "published";
  const content = { ...current.content };
  const languages = { ...current.languages };
  if (publishing) {
    for (const language of Object.keys(content) as ContentLanguage[]) {
      if (content[language].status === "draft") {
        content[language] = { ...content[language], status: "published" };
        languages[language] = "published";
      }
    }
  }

  const detail: GrammarTopicDetail = {
    ...current,
    status,
    content,
    languages,
    updated_at: now,
    published_at: publishing ? now : current.published_at,
  };
  store.grammarDetails.set(slug, detail);
  replaceIn(
    store.grammar,
    (topic) => topic.slug === slug,
    (topic) => ({
      ...topic,
      status,
      languages,
      updated_at: now,
      published_at: publishing ? now : topic.published_at,
    }),
  );
  replaceIn(
    store.content,
    (entry) => entry.slug === slug && entry.type === "grammar",
    (entry) => ({ ...entry, status, updated_at: now, published_at: publishing ? now : entry.published_at }),
  );
  return delay(detail, 420);
}

export async function createGrammarTopic(draft: GrammarTopicDraft): Promise<GrammarTopicRow> {
  const now = timestampOffset(0, 12, 0);
  const category = grammarCategorySummaries.find((entry) => entry.slug === draft.category);
  const row: GrammarTopicRow = {
    id: mockId("grammar-new", store.grammar.length + 1),
    slug: draft.slug,
    name: draft.title,
    description: draft.description,
    category: draft.category,
    category_name: category?.name ?? draft.category,
    level: draft.level,
    cefr_levels: [draft.level],
    languages: { uz: "missing", en: "missing", ru: "missing" },
    status: "draft",
    question_count: 0,
    has_visual: false,
    has_ai_tutor: false,
    estimated_minutes: draft.estimated_minutes,
    ielts_relevant: draft.ielts_relevant,
    updated_at: now,
    published_at: null,
    author: "You",
  };
  store.grammar.unshift(row);
  store.content.unshift({
    id: row.id,
    title: row.name,
    slug: row.slug,
    type: "grammar",
    category: row.category,
    category_name: row.category_name,
    level: row.level,
    languages: [],
    status: "draft",
    source: "curated",
    author: "You",
    updated_at: now,
    published_at: null,
  });
  return delay(row, 360);
}

// ---- Paywall ---------------------------------------------------------------------------------

export async function getFeatureAccess(): Promise<FeatureAccess[]> {
  return delay([...store.features]);
}

export async function updateFeatureAccess(key: string, patch: Partial<FeatureAccess>): Promise<FeatureAccess> {
  const feature = replaceIn(
    store.features,
    (entry) => entry.key === key,
    (entry) => ({ ...entry, ...patch, updated_at: timestampOffset(0, 12, 0) }),
  );
  if (!feature) throw new Error("Feature not found");
  return delay(feature, 240);
}

// ---- Settings --------------------------------------------------------------------------------

export async function getSiteSettings(): Promise<SiteSettings> {
  return delay(store.settings);
}

export async function updateSiteSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
  store.settings = {
    ...store.settings,
    ...patch,
    general: { ...store.settings.general, ...patch.general },
    learner_defaults: { ...store.settings.learner_defaults, ...patch.learner_defaults },
    features: { ...store.settings.features, ...patch.features },
    maintenance: { ...store.settings.maintenance, ...patch.maintenance },
    updated_at: timestampOffset(0, 12, 0),
  };
  return delay(store.settings, 240);
}

export async function getWallpapers(): Promise<Wallpaper[]> {
  return delay([...store.wallpapers].sort((a, b) => a.order - b.order));
}

export async function setWallpaperEnabled(id: string, enabled: boolean): Promise<Wallpaper> {
  const wallpaper = replaceIn(store.wallpapers, (entry) => entry.id === id, (entry) => ({ ...entry, enabled }));
  if (!wallpaper) throw new Error("Wallpaper not found");
  return delay(wallpaper, 160);
}

export async function moveWallpaper(id: string, direction: "up" | "down"): Promise<Wallpaper[]> {
  const sorted = [...store.wallpapers].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((entry) => entry.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= sorted.length) return delay(sorted, 60);

  const currentOrder = sorted[index]!.order;
  const targetOrder = sorted[target]!.order;
  replaceIn(store.wallpapers, (entry) => entry.id === sorted[index]!.id, (entry) => ({ ...entry, order: targetOrder }));
  replaceIn(store.wallpapers, (entry) => entry.id === sorted[target]!.id, (entry) => ({ ...entry, order: currentOrder }));
  return delay([...store.wallpapers].sort((a, b) => a.order - b.order), 120);
}

// ---- Learners --------------------------------------------------------------------------------

export async function getLearners(query: LearnerQuery = {}): Promise<Paged<Learner>> {
  const { search, plan, level, status, sort = "joined", page = 1, page_size } = query;
  let items = store.learners;

  if (search) items = items.filter((learner) => matches(learner.name, search) || matches(learner.email, search));
  if (plan && plan !== "all") items = items.filter((learner) => learner.plan === plan);
  if (level && level !== "all") items = items.filter((learner) => learner.level === level);
  if (status && status !== "all") items = items.filter((learner) => learner.status === status);

  const sorted = [...items].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "last_active") return b.last_active_at.localeCompare(a.last_active_at);
    return b.joined_at.localeCompare(a.joined_at);
  });

  return delay(paginate(sorted, page, page_size));
}

export async function getLearner(id: string): Promise<LearnerDetail> {
  const learner = store.learners.find((entry) => entry.id === id);
  if (!learner) throw new Error("Learner not found");
  return delay(buildLearnerDetail(learner));
}

export async function updateLearnerPlan(id: string, plan: PlanCode): Promise<Learner> {
  const learner = replaceIn(store.learners, (entry) => entry.id === id, (entry) => ({ ...entry, plan }));
  if (!learner) throw new Error("Learner not found");
  return delay(learner, 280);
}

export async function updateLearnerStatus(id: string, status: LearnerStatus): Promise<Learner> {
  const learner = replaceIn(store.learners, (entry) => entry.id === id, (entry) => ({ ...entry, status }));
  if (!learner) throw new Error("Learner not found");
  return delay(learner, 280);
}

export const ownerToday = MOCK_TODAY;
