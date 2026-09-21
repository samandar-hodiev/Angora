/**
 * Site settings and the wallpaper library.
 *
 * The first eleven wallpapers are the presets the learner app already ships
 * (features/profile/wallpaper.ts); the rest are the library the Owner can grow into. A
 * disabled wallpaper stops appearing in learner Settings — that switch is the whole point of
 * this page, so the preview here is the real CSS the learner will see, not a thumbnail.
 */

import type { SiteSettings, Wallpaper } from "../types";
import { timestampOffset } from "../lib/mock";

export const wallpapers: Wallpaper[] = [
  { id: "aurora", name: "Aurora", preview: "radial-gradient(60% 50% at 12% 8%, oklch(69.6% 0.17 162.48 / 0.42), transparent 70%), radial-gradient(52% 46% at 88% 18%, oklch(0.72 0.13 225 / 0.34), transparent 70%), radial-gradient(64% 56% at 50% 96%, oklch(0.78 0.11 150 / 0.26), transparent 70%)", enabled: true, order: 1, animated: false, usage_count: 534 },
  { id: "dusk", name: "Dusk", preview: "radial-gradient(58% 48% at 82% 10%, oklch(0.62 0.18 300 / 0.38), transparent 70%), radial-gradient(54% 48% at 12% 26%, oklch(0.66 0.16 265 / 0.32), transparent 70%), radial-gradient(70% 55% at 50% 98%, oklch(0.7 0.13 330 / 0.24), transparent 70%)", enabled: true, order: 2, animated: false, usage_count: 103 },
  { id: "sunrise", name: "Sunrise", preview: "radial-gradient(58% 50% at 14% 12%, oklch(0.82 0.15 70 / 0.38), transparent 70%), radial-gradient(52% 46% at 86% 22%, oklch(0.75 0.16 25 / 0.28), transparent 70%), radial-gradient(66% 54% at 55% 96%, oklch(0.85 0.12 95 / 0.24), transparent 70%)", enabled: true, order: 3, animated: false, usage_count: 696 },
  { id: "ocean", name: "Ocean", preview: "radial-gradient(60% 52% at 16% 14%, oklch(0.66 0.14 245 / 0.4), transparent 70%), radial-gradient(54% 46% at 84% 12%, oklch(0.74 0.12 200 / 0.3), transparent 70%), radial-gradient(66% 56% at 48% 96%, oklch(0.7 0.11 220 / 0.26), transparent 70%)", enabled: true, order: 4, animated: false, usage_count: 109 },
  { id: "mist", name: "Mist", preview: "radial-gradient(70% 60% at 20% 10%, oklch(0.75 0.03 165 / 0.35), transparent 72%), radial-gradient(60% 50% at 85% 25%, oklch(0.7 0.02 240 / 0.28), transparent 72%), radial-gradient(75% 60% at 50% 100%, oklch(0.8 0.02 140 / 0.22), transparent 72%)", enabled: true, order: 5, animated: false, usage_count: 862 },
  { id: "aurora-live", name: "Aurora live", preview: "linear-gradient(168deg, oklch(0.19 0.06 258) 0%, oklch(0.23 0.07 236) 38%, oklch(0.29 0.08 205) 66%, oklch(0.2 0.05 248) 100%)", enabled: true, order: 6, animated: true, usage_count: 491 },
  { id: "blossom", name: "Blossom", preview: "radial-gradient(58% 50% at 16% 10%, oklch(0.78 0.14 355 / 0.38), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.8 0.1 20 / 0.3), transparent 70%), radial-gradient(68% 56% at 52% 96%, oklch(0.84 0.08 340 / 0.26), transparent 72%)", enabled: true, order: 7, animated: false, usage_count: 56 },
  { id: "ember", name: "Ember", preview: "radial-gradient(60% 52% at 14% 14%, oklch(0.66 0.17 40 / 0.4), transparent 70%), radial-gradient(54% 46% at 88% 18%, oklch(0.6 0.19 18 / 0.32), transparent 70%), radial-gradient(70% 58% at 48% 98%, oklch(0.72 0.14 62 / 0.26), transparent 72%)", enabled: true, order: 8, animated: false, usage_count: 789 },
  { id: "lavender", name: "Lavender", preview: "radial-gradient(60% 50% at 20% 10%, oklch(0.72 0.12 290 / 0.4), transparent 70%), radial-gradient(54% 48% at 85% 22%, oklch(0.76 0.09 265 / 0.3), transparent 70%), radial-gradient(70% 58% at 50% 98%, oklch(0.8 0.07 310 / 0.24), transparent 72%)", enabled: true, order: 9, animated: false, usage_count: 818 },
  { id: "sand", name: "Sand", preview: "radial-gradient(64% 54% at 18% 12%, oklch(0.82 0.07 80 / 0.4), transparent 72%), radial-gradient(56% 48% at 86% 24%, oklch(0.78 0.06 55 / 0.3), transparent 72%), radial-gradient(72% 58% at 48% 98%, oklch(0.86 0.05 95 / 0.24), transparent 72%)", enabled: true, order: 10, animated: false, usage_count: 71 },
  { id: "prism", name: "Prism", preview: "radial-gradient(58% 50% at 12% 10%, oklch(0.62 0.24 27 / 0.48), transparent 70%), radial-gradient(56% 48% at 88% 18%, oklch(0.6 0.22 264 / 0.42), transparent 70%), radial-gradient(66% 56% at 50% 98%, oklch(0.72 0.2 145 / 0.38), transparent 72%)", enabled: true, order: 11, animated: false, usage_count: 476 },
  { id: "midnight", name: "Midnight", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.16 265 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.13 299 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.10 237 / 0.24), transparent 72%)", enabled: true, order: 12, animated: false, usage_count: 741 },
  { id: "forest", name: "Forest", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.13 148 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.10 182 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.08 120 / 0.24), transparent 72%)", enabled: true, order: 13, animated: false, usage_count: 834 },
  { id: "coral", name: "Coral", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.16 28 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.13 62 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.10 0 / 0.24), transparent 72%)", enabled: true, order: 14, animated: false, usage_count: 151 },
  { id: "glacier", name: "Glacier", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.12 212 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.10 246 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.07 184 / 0.24), transparent 72%)", enabled: true, order: 15, animated: false, usage_count: 124 },
  { id: "saffron", name: "Saffron", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.15 78 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.12 112 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.09 50 / 0.24), transparent 72%)", enabled: true, order: 16, animated: false, usage_count: 53 },
  { id: "plum", name: "Plum", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.15 330 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.12 4 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.09 302 / 0.24), transparent 72%)", enabled: true, order: 17, animated: false, usage_count: 138 },
  { id: "slate", name: "Slate", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.04 230 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.03 264 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.02 202 / 0.24), transparent 72%)", enabled: false, order: 18, animated: false, usage_count: 87 },
  { id: "citrus", name: "Citrus", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.15 110 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.12 144 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.09 82 / 0.24), transparent 72%)", enabled: true, order: 19, animated: false, usage_count: 24 },
  { id: "rose-quartz", name: "Rose quartz", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.12 5 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.10 39 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.07 337 / 0.24), transparent 72%)", enabled: true, order: 20, animated: false, usage_count: 85 },
  { id: "teal-drift", name: "Teal drift", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.13 192 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.10 226 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.08 164 / 0.24), transparent 72%)", enabled: true, order: 21, animated: false, usage_count: 94 },
  { id: "indigo", name: "Indigo", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.15 275 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.12 309 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.09 247 / 0.24), transparent 72%)", enabled: false, order: 22, animated: false, usage_count: 91 },
  { id: "amber", name: "Amber", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.16 62 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.13 96 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.10 34 / 0.24), transparent 72%)", enabled: true, order: 23, animated: false, usage_count: 12 },
  { id: "moss", name: "Moss", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.11 135 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.09 169 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.07 107 / 0.24), transparent 72%)", enabled: true, order: 24, animated: false, usage_count: 49 },
  { id: "storm", name: "Storm", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.07 250 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.06 284 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.04 222 / 0.24), transparent 72%)", enabled: true, order: 25, animated: false, usage_count: 102 },
  { id: "papaya", name: "Papaya", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.16 45 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.13 79 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.10 17 / 0.24), transparent 72%)", enabled: true, order: 26, animated: false, usage_count: 63 },
  { id: "iris", name: "Iris", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.14 295 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.11 329 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.08 267 / 0.24), transparent 72%)", enabled: false, order: 27, animated: false, usage_count: 52 },
  { id: "jade", name: "Jade", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.14 165 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.11 199 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.08 137 / 0.24), transparent 72%)", enabled: true, order: 28, animated: false, usage_count: 41 },
  { id: "dune", name: "Dune", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.09 88 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.07 122 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.05 60 / 0.24), transparent 72%)", enabled: false, order: 29, animated: false, usage_count: 62 },
  { id: "cobalt", name: "Cobalt", preview: "radial-gradient(60% 50% at 14% 10%, oklch(0.72 0.17 245 / 0.4), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.68 0.14 279 / 0.3), transparent 70%), radial-gradient(68% 56% at 50% 97%, oklch(0.8 0.10 217 / 0.24), transparent 72%)", enabled: true, order: 30, animated: false, usage_count: 67 },
];

export const siteSettings: SiteSettings = {
  general: {
    site_name: "Engora",
    site_description: "Your AI English coach — practice, feedback and a plan that adapts to you.",
    logo_url: null,
    support_email: "support@engora.com",
    timezone: "Asia/Tashkent",
  },
  learner_defaults: {
    interface_language: "uz",
    explanation_language: "uz",
    theme: "dark",
    landing_page: "dashboard",
    daily_goal_minutes: 20,
    onboarding_placement_test: true,
  },
  features: {
    ai_coach_enabled: true,
    placement_test_enabled: true,
    leaderboard_enabled: false,
    public_registration: true,
  },
  maintenance: {
    enabled: false,
    message: "Engora is being updated. We will be back in a few minutes.",
    allow_owner_access: true,
  },
  updated_at: timestampOffset(2, 16, 40),
};
