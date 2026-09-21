/**
 * The platform's mock time series and headline numbers.
 *
 * The whole year is generated once, deterministically, and every range the dashboard offers is
 * a window onto it — so "30 days" and "12 months" always agree with each other, exactly as a
 * real backend reading one table would.
 */

import type {
  ActivityEvent,
  ConversionSummary,
  HealthCheck,
  LearnerGrowthPoint,
  PlanChange,
  PlanDistributionSlice,
} from "../types";
import { MOCK_TODAY, dayOffset, mockId, seedFrom, seededRandom, timestampOffset } from "../lib/mock";

/** Where the platform stands on MOCK_TODAY. The series is built to land exactly here. */
export const todayTotals = { free: 3421, premium: 610, unlimited: 250 } as const;

const HISTORY_DAYS = 365;

function buildSeries(): LearnerGrowthPoint[] {
  const random = seededRandom(seedFrom("engora-growth-v1"));
  const days: { new_free: number; new_premium: number; new_unlimited: number; active_ratio: number }[] = [];

  for (let i = 0; i < HISTORY_DAYS; i += 1) {
    // Signups accelerate through the year, dip at weekends, and spike a little each September.
    const progress = i / HISTORY_DAYS;
    const weekday = (Date.parse(dayOffset(i - HISTORY_DAYS + 1)) / 86_400_000 + 4) % 7;
    const weekend = weekday === 0 || weekday === 6 ? 0.62 : 1;
    const month = Number(dayOffset(i - HISTORY_DAYS + 1).slice(5, 7));
    const season = month === 9 || month === 1 ? 1.35 : month === 7 ? 0.8 : 1;
    const trend = 0.55 + progress * 1.1;

    const base = 3.2 * trend * weekend * season;
    const new_free = Math.max(0, Math.round(base * (0.75 + random() * 0.7)));
    const new_premium = Math.max(0, Math.round(base * 0.22 * (0.5 + random() * 1.1)));
    const new_unlimited = Math.max(0, Math.round(base * 0.09 * (0.3 + random() * 1.3)));
    days.push({ new_free, new_premium, new_unlimited, active_ratio: 0.36 + random() * 0.08 });
  }

  const sum = (key: "new_free" | "new_premium" | "new_unlimited") =>
    days.reduce((total, day) => total + day[key], 0);

  // Anchoring the end of the series means every window ends on the numbers the KPI cards show.
  let free = todayTotals.free - sum("new_free");
  let premium = todayTotals.premium - sum("new_premium");
  let unlimited = todayTotals.unlimited - sum("new_unlimited");

  return days.map((day, i) => {
    free += day.new_free;
    premium += day.new_premium;
    unlimited += day.new_unlimited;
    const total = free + premium + unlimited;
    return {
      date: dayOffset(i - HISTORY_DAYS + 1),
      total,
      free,
      premium,
      unlimited,
      new_learners: day.new_free + day.new_premium + day.new_unlimited,
      new_free: day.new_free,
      new_premium: day.new_premium,
      new_unlimited: day.new_unlimited,
      active: Math.round(total * day.active_ratio),
    };
  });
}

/** One year of daily points, oldest first, ending on MOCK_TODAY. */
export const growthSeries: LearnerGrowthPoint[] = buildSeries();

export const latestPoint = growthSeries[growthSeries.length - 1]!;

export function windowOf(days: number): LearnerGrowthPoint[] {
  return growthSeries.slice(Math.max(0, growthSeries.length - days));
}

/** Weekly buckets for long ranges: the last point of each week, with the week's arrivals summed. */
export function bucketWeekly(points: LearnerGrowthPoint[]): LearnerGrowthPoint[] {
  const buckets: LearnerGrowthPoint[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const week = points.slice(i, i + 7);
    const last = week[week.length - 1]!;
    buckets.push({
      ...last,
      new_learners: week.reduce((t, p) => t + p.new_learners, 0),
      new_free: week.reduce((t, p) => t + p.new_free, 0),
      new_premium: week.reduce((t, p) => t + p.new_premium, 0),
      new_unlimited: week.reduce((t, p) => t + p.new_unlimited, 0),
      active: Math.round(week.reduce((t, p) => t + p.active, 0) / week.length),
    });
  }
  return buckets;
}

export const planDistribution: PlanDistributionSlice[] = [
  {
    plan: "free",
    learners: todayTotals.free,
    share: todayTotals.free / latestPoint.total,
    mrr_cents: 0,
  },
  {
    plan: "premium",
    learners: todayTotals.premium,
    share: todayTotals.premium / latestPoint.total,
    mrr_cents: todayTotals.premium * 1200,
  },
  {
    plan: "unlimited",
    learners: todayTotals.unlimited,
    share: todayTotals.unlimited / latestPoint.total,
    mrr_cents: todayTotals.unlimited * 2900,
  },
];

export const mrrCents = planDistribution.reduce((total, slice) => total + slice.mrr_cents, 0);

export const conversionSummary: ConversionSummary = {
  period_label: "September 2026",
  free_to_premium: 84,
  premium_to_unlimited: 21,
  churned: 12,
  conversion_rate: 20.1,
  previous_conversion_rate: 18.4,
};

export const healthChecks: HealthCheck[] = [
  { key: "content", label: "Content system", state: "operational", detail: "149 grammar topics indexed · last sync 12m ago" },
  { key: "ai", label: "AI services", state: "degraded", detail: "Explanation queue running 8s slower than usual" },
  { key: "paywall", label: "Paywall configuration", state: "operational", detail: "13 features mapped across 3 plans" },
  { key: "grammar", label: "Published grammar topics", state: "attention", detail: "12 topics waiting in review for 5+ days" },
  { key: "storage", label: "Media storage", state: "operational", detail: "R2 bucket · 42% of quota used" },
];

const conversionNames = [
  "Dilnoza Karimova",
  "Javohir Tursunov",
  "Malika Yusupova",
  "Sardor Rahimov",
  "Nilufar Abdullayeva",
  "Bekzod Ismoilov",
  "Kamila Ergasheva",
  "Otabek Nazarov",
  "Sevara Qodirova",
  "Rustam Olimov",
];

export const recentConversions: PlanChange[] = conversionNames.map((name, i) => {
  const random = seededRandom(seedFrom(`conversion:${name}`));
  const toUnlimited = random() > 0.72;
  return {
    id: mockId("conversion", i),
    learner_id: mockId("learner", (i * 7) % 60),
    learner_name: name,
    avatar_url: null,
    from_plan: toUnlimited ? "premium" : "free",
    to_plan: toUnlimited ? "unlimited" : "premium",
    amount_cents: toUnlimited ? 2900 : 1200,
    changed_at: timestampOffset(i * 0.6 + random(), 8 + Math.floor(random() * 10), Math.floor(random() * 59)),
  };
});

export const activityFeed: ActivityEvent[] = [
  {
    id: mockId("activity", 1),
    kind: "content_published",
    message: 'Grammar topic "Past Perfect Continuous" published',
    detail: "B2 · Tenses & Aspects · UZ, EN",
    actor: "You",
    created_at: timestampOffset(0, 9, 12),
  },
  {
    id: mockId("activity", 2),
    kind: "subscription_activated",
    message: "Dilnoza Karimova upgraded to Premium",
    detail: "$12.00 / month",
    actor: "System",
    created_at: timestampOffset(0, 8, 41),
  },
  {
    id: mockId("activity", 3),
    kind: "paywall_changed",
    message: "AI Grammar Tutor moved to Premium only",
    detail: "Free learners now see the upgrade prompt",
    actor: "You",
    created_at: timestampOffset(0, 7, 55),
  },
  {
    id: mockId("activity", 4),
    kind: "learner_registered",
    message: "32 learners registered today",
    detail: "26 Free · 5 Premium · 1 Unlimited",
    actor: "System",
    created_at: timestampOffset(0, 6, 30),
  },
  {
    id: mockId("activity", 5),
    kind: "content_review",
    message: 'Vocabulary pack "Academic Word List 4" moved to review',
    detail: "B2 · 60 items",
    actor: "Nodira A.",
    created_at: timestampOffset(1, 17, 20),
  },
  {
    id: mockId("activity", 6),
    kind: "wallpaper_enabled",
    message: 'Wallpaper "Prism" enabled for learners',
    detail: "Now selectable in learner Settings",
    actor: "You",
    created_at: timestampOffset(1, 15, 2),
  },
  {
    id: mockId("activity", 7),
    kind: "content_updated",
    message: 'Grammar topic "Conditionals type 3" updated',
    detail: "Russian explanation added",
    actor: "Nodira A.",
    created_at: timestampOffset(2, 11, 48),
  },
  {
    id: mockId("activity", 8),
    kind: "settings_changed",
    message: "Default explanation language set to Uzbek",
    detail: "Applies to new accounts only",
    actor: "You",
    created_at: timestampOffset(3, 10, 5),
  },
];

export const generatedAt = timestampOffset(0, 9, 30);
export const asOf = MOCK_TODAY;
