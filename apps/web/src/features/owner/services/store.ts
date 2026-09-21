/**
 * The mock database.
 *
 * Generated data in ../data is pure and never mutated; this module holds the copies the Owner
 * can change during a session. Nothing is persisted — a reload is a fresh "database", which is
 * exactly what a mock should do. Replacing ../services/index.ts with real HTTP calls deletes
 * this file and nothing else.
 */

import type {
  ContentItem,
  FeatureAccess,
  GrammarTopicDetail,
  GrammarTopicRow,
  Learner,
  SiteSettings,
  Wallpaper,
} from "../types";
import { contentItems } from "../data/content";
import { featureAccess } from "../data/features";
import { grammarTopics } from "../data/grammar";
import { learners } from "../data/learners";
import { siteSettings, wallpapers } from "../data/settings";

export const store = {
  learners: learners.map((learner) => ({ ...learner })) as Learner[],
  content: contentItems.map((item) => ({ ...item })) as ContentItem[],
  grammar: grammarTopics.map((topic) => ({ ...topic })) as GrammarTopicRow[],
  /** Details are built lazily and kept once edited, so an edit survives navigation. */
  grammarDetails: new Map<string, GrammarTopicDetail>(),
  features: featureAccess.map((feature) => ({ ...feature })) as FeatureAccess[],
  wallpapers: wallpapers.map((wallpaper) => ({ ...wallpaper })) as Wallpaper[],
  settings: structuredClone(siteSettings) as SiteSettings,
};
