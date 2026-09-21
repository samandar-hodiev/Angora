/**
 * The CMS catalogue: every learner-facing item across the seven skills.
 *
 * Grammar rows are the real grammar topics (./grammar.ts) rather than a parallel list, so the
 * CMS and the Grammar CMS can never disagree about what exists.
 */

import type { CEFRLevel, ContentItem, ContentLanguage, ContentStat, ContentStatus, SkillKey } from "../types";
import { between, mockId, pick, seedFrom, seededRandom, timestampOffset } from "../lib/mock";
import { skillLabels } from "../lib/format";
import { grammarTopics } from "./grammar";

const levels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const authors = ["Nodira A.", "You", "Kamron S.", "AI draft"];

const titleSeeds: Record<Exclude<SkillKey, "grammar">, { prefix: string[]; topic: string[] }> = {
  vocabulary: {
    prefix: ["Word pack", "Collocations", "Academic set", "Phrasal verbs"],
    topic: ["Work & careers", "Travel", "Health", "Technology", "Environment", "Education", "Money", "Food"],
  },
  speaking: {
    prefix: ["Speaking task", "Roleplay", "Pronunciation drill", "Fluency set"],
    topic: ["Job interview", "Ordering food", "Describing a photo", "Giving opinions", "Small talk", "Making a complaint"],
  },
  writing: {
    prefix: ["Writing task", "Email template", "Essay plan", "Paragraph clinic"],
    topic: ["Formal email", "Opinion essay", "Report on a chart", "Cover letter", "Complaint letter"],
  },
  reading: {
    prefix: ["Reading set", "Article", "Skimming drill", "Text analysis"],
    topic: ["Remote work", "City transport", "Sleep science", "Renewable energy", "Ancient trade", "Social media"],
  },
  listening: {
    prefix: ["Listening set", "Dialogue", "Lecture", "Podcast clip"],
    topic: ["Airport announcements", "University lecture", "Two friends planning", "Radio interview", "Workplace briefing"],
  },
  ielts: {
    prefix: ["IELTS practice", "Mock section", "Band descriptor drill", "Full mock"],
    topic: ["Writing Task 1", "Writing Task 2", "Speaking Part 2", "Listening Section 3", "Reading Passage 2"],
  },
};

const skillCounts: Record<Exclude<SkillKey, "grammar">, number> = {
  vocabulary: 86,
  speaking: 54,
  writing: 41,
  reading: 63,
  listening: 58,
  ielts: 37,
};

function statusFor(random: () => number): ContentStatus {
  const roll = random();
  if (roll > 0.93) return "draft";
  if (roll > 0.87) return "review";
  if (roll > 0.84) return "ai_generated";
  if (roll > 0.81) return "archived";
  return "published";
}

function languagesFor(random: () => number): ContentLanguage[] {
  const languages: ContentLanguage[] = ["en"];
  if (random() > 0.1) languages.unshift("uz");
  if (random() > 0.55) languages.push("ru");
  return languages;
}

const skillItems: ContentItem[] = (Object.keys(skillCounts) as (keyof typeof skillCounts)[]).flatMap((skill) =>
  Array.from({ length: skillCounts[skill] }, (_, i) => {
    const random = seededRandom(seedFrom(`content:${skill}:${i}`));
    const seeds = titleSeeds[skill];
    const topic = pick(random, seeds.topic);
    const status = statusFor(random);
    const updatedDaysAgo = between(random, 0, 150);
    const slug = `${skill}-${topic.toLowerCase().replace(/[^a-z]+/g, "-")}-${i}`;
    return {
      id: mockId(`content:${skill}`, i),
      title: `${pick(random, seeds.prefix)}: ${topic}`,
      slug,
      type: skill,
      category: skill,
      category_name: skillLabels[skill],
      level: pick(random, levels),
      languages: languagesFor(random),
      status,
      source: random() > 0.78 ? "ai" : random() > 0.72 ? "imported" : "curated",
      author: pick(random, authors),
      updated_at: timestampOffset(updatedDaysAgo, between(random, 9, 19), between(random, 0, 59)),
      published_at: status === "published" ? timestampOffset(updatedDaysAgo + between(random, 1, 30), 12, 0) : null,
    } satisfies ContentItem;
  }),
);

const grammarItems: ContentItem[] = grammarTopics.map((topic) => ({
  id: topic.id,
  title: topic.name,
  slug: topic.slug,
  type: "grammar",
  category: topic.category,
  category_name: topic.category_name,
  level: topic.level,
  languages: (Object.keys(topic.languages) as ContentLanguage[]).filter(
    (language) => topic.languages[language] !== "missing",
  ),
  status: topic.status,
  source: topic.author === "AI draft" ? "ai" : "curated",
  author: topic.author,
  updated_at: topic.updated_at,
  published_at: topic.published_at,
}));

export const contentItems: ContentItem[] = [...grammarItems, ...skillItems].sort((a, b) =>
  b.updated_at.localeCompare(a.updated_at),
);

export const contentStats: ContentStat[] = (Object.keys(skillLabels) as SkillKey[]).map((skill) => {
  const items = contentItems.filter((item) => item.type === skill);
  return {
    skill,
    label: skillLabels[skill],
    total: items.length,
    published: items.filter((i) => i.status === "published").length,
    draft: items.filter((i) => i.status === "draft" || i.status === "ai_generated").length,
    review: items.filter((i) => i.status === "review").length,
    archived: items.filter((i) => i.status === "archived").length,
  };
});

export const contentTotals = contentStats.reduce(
  (totals, stat) => ({
    total: totals.total + stat.total,
    published: totals.published + stat.published,
    draft: totals.draft + stat.draft,
    review: totals.review + stat.review,
    archived: totals.archived + stat.archived,
  }),
  { total: 0, published: 0, draft: 0, review: 0, archived: 0 },
);
