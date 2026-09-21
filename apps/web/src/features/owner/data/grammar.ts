/**
 * Grammar CMS mock data, built on the real learner curriculum (./curriculum.ts).
 *
 * The Owner manages exactly the topics the learner app ships — 149 topics across 21
 * categories — so the counts here are the counts on the learner side.
 */

import type {
  CEFRLevel,
  ContentLanguage,
  ContentStatus,
  GrammarCategorySummary,
  GrammarLevelAdaptation,
  GrammarLocalizedContent,
  GrammarSection,
  GrammarSectionKey,
  GrammarSectionMeta,
  GrammarTopicDetail,
  GrammarTopicRow,
  LanguageStatus,
} from "../types";
import { between, mockId, pick, seedFrom, seededRandom, timestampOffset } from "../lib/mock";
import { grammarCurriculum } from "./curriculum";

export const grammarSectionMeta: GrammarSectionMeta[] = [
  { key: "rule", label: "The rule", hint: "The canonical explanation. One or two paragraphs, no hedging." },
  { key: "formula", label: "Formula", hint: "The pattern learners can copy: affirmative, negative, question." },
  { key: "usage", label: "When to use", hint: "Each situation the form covers, one line each." },
  { key: "examples", label: "Examples", hint: "Natural sentences, not textbook sentences." },
  { key: "signal_words", label: "Signal words", hint: "Words that tell a learner this form is expected." },
  { key: "common_mistakes", label: "Common mistakes", hint: "Wrong → right, with the reason." },
  { key: "dont_forget", label: "Don't forget", hint: "The one thing learners drop under pressure." },
  { key: "exceptions", label: "Exceptions", hint: "Where the rule stops applying." },
  { key: "tips", label: "Tips", hint: "How to remember it. Short and concrete." },
  { key: "related", label: "Related grammar", hint: "Topics to compare this one against." },
];

export const grammarSectionKeys = grammarSectionMeta.map((s) => s.key);

const authors = ["Nodira A.", "You", "AI draft", "Kamron S."];

// ---- Rows ----------------------------------------------------------------------------------

const flat = grammarCurriculum.flatMap((category) =>
  category.topics.map((topic) => ({ category, topic })),
);

/** Exactly 126 published / 12 draft / 11 review — the editorial state the dashboard reports. */
function statusFor(index: number): ContentStatus {
  const order = (index * 37) % flat.length;
  if (order < 12) return "draft";
  if (order < 23) return "review";
  return "published";
}

function languagesFor(index: number, status: ContentStatus): Record<ContentLanguage, LanguageStatus> {
  const random = seededRandom(seedFrom(`grammar-lang:${index}`));
  const published: LanguageStatus = status === "published" ? "published" : "draft";
  return {
    uz: published,
    en: status === "published" && random() > 0.06 ? "published" : "draft",
    ru: random() > 0.62 ? "published" : random() > 0.35 ? "draft" : "missing",
  };
}

export const grammarTopics: GrammarTopicRow[] = flat.map(({ category, topic }, index) => {
  const random = seededRandom(seedFrom(`grammar-row:${topic.slug}`));
  const status = statusFor(index);
  const updatedDaysAgo = between(random, 0, 120);
  return {
    id: mockId("grammar", index),
    slug: topic.slug,
    name: topic.name,
    description: topic.description,
    category: category.slug,
    category_name: category.name,
    level: (topic.level || "A1") as CEFRLevel,
    cefr_levels: (topic.cefr_levels.length ? topic.cefr_levels : [topic.level]) as CEFRLevel[],
    languages: languagesFor(index, status),
    status,
    question_count: status === "draft" ? 0 : between(random, 6, 18),
    has_visual: random() > 0.35,
    has_ai_tutor: status === "published" || status === "approved",
    estimated_minutes: topic.estimated_minutes,
    ielts_relevant: topic.ielts_relevant,
    updated_at: timestampOffset(updatedDaysAgo, between(random, 9, 19), between(random, 0, 59)),
    published_at: status === "published" ? timestampOffset(updatedDaysAgo + between(random, 1, 40), 12, 0) : null,
    author: pick(random, authors),
  };
});

export const grammarTopicsBySlug = new Map(grammarTopics.map((topic) => [topic.slug, topic]));

export const grammarCategorySummaries: GrammarCategorySummary[] = grammarCurriculum.map((category) => {
  const topics = grammarTopics.filter((topic) => topic.category === category.slug);
  return {
    slug: category.slug,
    name: category.name,
    description: category.description,
    topics: topics.length,
    published: topics.filter((t) => t.status === "published").length,
    draft: topics.filter((t) => t.status === "draft").length,
    review: topics.filter((t) => t.status === "review").length,
  };
});

// ---- Lesson bodies ---------------------------------------------------------------------------

/**
 * Explanations are written per language. In Uzbek and Russian the prose is the local language
 * but English grammar terminology stays English — that is how the learner app teaches, and
 * translating "Present Perfect" into Uzbek would teach a term no exam uses.
 */
type Writer = (name: string, category: string) => Record<GrammarSectionKey, { body: string; items: string[] }>;

const uzWriter: Writer = (name, category) => ({
  rule: {
    body: `${name} — ${category} bo'limidagi asosiy structure. U aniq bir vaqt va holatni ifodalaydi, shuning uchun tanlash gapning meaning'iga bog'liq.\n\nO'zbek tilida to'g'ridan-to'g'ri ekvivalenti yo'q, shuning uchun tarjima qilib emas, situation orqali o'rganish kerak.`,
    items: [],
  },
  formula: { body: "", items: [`Affirmative: subject + ${name.toLowerCase()} form + object`, `Negative: subject + do/does/did + not + base verb`, `Question: (Wh-) + auxiliary + subject + base verb?`] },
  usage: { body: "", items: ["Tugallangan yoki takrorlanadigan action haqida gapirganda", "Vaqt aniq ko'rsatilgan bo'lsa", "Hikoya va report yozishda", "Exam task'larida sequence tuzishda"] },
  examples: { body: "", items: ["She finished the report before the meeting started.", "They didn't tell us about the change.", "Did you speak to the manager yesterday?"] },
  signal_words: { body: "", items: ["yesterday", "last week", "in 2019", "two days ago", "when I was a child"] },
  common_mistakes: {
    body: "",
    items: [
      "❌ She didn't went home. → ✅ She didn't go home. — do/does/did dan keyin base verb keladi.",
      "❌ I have seen him yesterday. → ✅ I saw him yesterday. — aniq past vaqt bilan Present Perfect ishlatilmaydi.",
    ],
  },
  dont_forget: { body: "Auxiliary verb qo'shilganda asosiy verb o'z base form'iga qaytadi. Bu eng ko'p yo'qoladigan qoida.", items: [] },
  exceptions: { body: "", items: ["Irregular verb'lar alohida yodlanadi — ular umumiy qoidaga bo'ysunmaydi.", "Formal yozuvda ba'zan boshqa tense afzal ko'riladi."] },
  tips: { body: "", items: ["Avval vaqtni belgilang, keyin form'ni tanlang — teskarisi emas.", "Har kuni 3 ta o'z hayotingizdan gap yozing.", "Signal words ro'yxatini yod oling: ular javobni deyarli aytib beradi."] },
  related: { body: "", items: [] },
});

const enWriter: Writer = (name, category) => ({
  rule: {
    body: `${name} belongs to ${category}. It marks a specific relationship between the action and the moment you are talking about, which is why the choice changes the meaning rather than only the style.\n\nLearners who pick it by feel get it wrong under pressure; pick it by the time relationship instead.`,
    items: [],
  },
  formula: { body: "", items: ["Affirmative: subject + verb form + object", "Negative: subject + auxiliary + not + base verb", "Question: (Wh-) + auxiliary + subject + base verb?"] },
  usage: { body: "", items: ["Talking about a finished action at a known time", "Telling a story in order", "Reporting what someone did", "Exam answers that need a clear sequence"] },
  examples: { body: "", items: ["She finished the report before the meeting started.", "They didn't tell us about the change.", "Did you speak to the manager yesterday?"] },
  signal_words: { body: "", items: ["yesterday", "last week", "in 2019", "two days ago", "when I was a child"] },
  common_mistakes: {
    body: "",
    items: [
      "❌ She didn't went home. → ✅ She didn't go home. — after did the main verb returns to its base form.",
      "❌ I have seen him yesterday. → ✅ I saw him yesterday. — a finished time marker rules out the Present Perfect.",
    ],
  },
  dont_forget: { body: "Once an auxiliary carries the tense, the main verb goes back to its base form. This is the rule learners drop first when they speak quickly.", items: [] },
  exceptions: { body: "", items: ["Irregular verbs have to be learned individually.", "Formal writing sometimes prefers a different tense for the same event."] },
  tips: { body: "", items: ["Decide the time first, then the form.", "Write three sentences a day about your own life.", "Learn the signal words — they almost answer the question for you."] },
  related: { body: "", items: [] },
});

const ruWriter: Writer = (name, category) => ({
  rule: {
    body: `${name} относится к разделу ${category}. Эта структура показывает связь действия с конкретным моментом времени, поэтому выбор формы меняет смысл, а не только стиль.\n\nПереводить напрямую с русского не стоит: ориентируйтесь на ситуацию, а не на перевод.`,
    items: [],
  },
  formula: { body: "", items: ["Affirmative: subject + verb form + object", "Negative: subject + auxiliary + not + base verb", "Question: (Wh-) + auxiliary + subject + base verb?"] },
  usage: { body: "", items: ["Завершённое действие в известный момент времени", "Рассказ о событиях по порядку", "Пересказ чужих действий"] },
  examples: { body: "", items: ["She finished the report before the meeting started.", "They didn't tell us about the change.", "Did you speak to the manager yesterday?"] },
  signal_words: { body: "", items: ["yesterday", "last week", "in 2019", "two days ago"] },
  common_mistakes: { body: "", items: ["❌ She didn't went home. → ✅ She didn't go home. — после did идёт base verb."] },
  dont_forget: { body: "Если время выражено вспомогательным глаголом, основной глагол стоит в base form.", items: [] },
  exceptions: { body: "", items: ["Irregular verbs заучиваются отдельно."] },
  tips: { body: "", items: ["Сначала определите время, потом форму.", "Записывайте три собственных примера в день."] },
  related: { body: "", items: [] },
});

const writers: Record<ContentLanguage, Writer> = { uz: uzWriter, en: enWriter, ru: ruWriter };

function buildSections(
  language: ContentLanguage,
  row: GrammarTopicRow,
  related: { slug: string; name: string }[],
): GrammarSection[] {
  const written = writers[language](row.name, row.category_name);
  return grammarSectionKeys.map((key) => {
    const section = written[key];
    return {
      key,
      body: section.body,
      items: key === "related" ? related.map((r) => r.name) : section.items,
      updated_at: row.updated_at,
    };
  });
}

function relatedTopics(row: GrammarTopicRow, count: number, offset: number): { slug: string; name: string }[] {
  const siblings = grammarTopics.filter((t) => t.category === row.category && t.slug !== row.slug);
  const pool = siblings.length >= count ? siblings : grammarTopics.filter((t) => t.slug !== row.slug);
  const start = (seedFrom(row.slug) + offset) % Math.max(1, pool.length);
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => {
    const topic = pool[(start + i * 3) % pool.length]!;
    return { slug: topic.slug, name: topic.name };
  });
}

const levelSummaries: Record<CEFRLevel, (name: string) => string> = {
  A1: (name) => `${name} in the simplest possible words, with one example per idea and no exceptions yet.`,
  A2: (name) => `${name} with everyday situations, short sentences and the two mistakes beginners make most.`,
  B1: (name) => `${name} compared with the form learners usually confuse it with, plus signal words.`,
  B2: (name) => `${name} in longer texts: how it shifts meaning in reported speech and in writing.`,
  C1: (name) => `${name} with register: when it sounds formal, when it sounds spoken, and what natives actually choose.`,
  C2: (name) => `${name} at the level of nuance, including the cases where the rule is broken deliberately.`,
};

function adaptationsFor(row: GrammarTopicRow): GrammarLevelAdaptation[] {
  const random = seededRandom(seedFrom(`adapt:${row.slug}`));
  return (["A1", "A2", "B1", "B2", "C1", "C2"] as CEFRLevel[]).map((level) => {
    const covered = row.cefr_levels.includes(level) || random() > 0.55;
    return {
      level,
      summary: levelSummaries[level](row.name),
      status: covered ? "generated" : "missing",
      generated_at: covered ? timestampOffset(between(random, 1, 60), 11, 0) : null,
    };
  });
}

export function buildGrammarDetail(row: GrammarTopicRow): GrammarTopicDetail {
  const curriculumTopic = grammarCurriculum
    .find((c) => c.slug === row.category)
    ?.topics.find((t) => t.slug === row.slug);
  const prerequisites = relatedTopics(row, 3, 11);
  const related = relatedTopics(row, 3, 47);

  const content = Object.fromEntries(
    (["uz", "en", "ru"] as ContentLanguage[]).map((language) => {
      const status = row.languages[language];
      const localized: GrammarLocalizedContent = {
        language,
        status,
        sections: status === "missing" ? [] : buildSections(language, row, related),
        updated_at: status === "missing" ? null : row.updated_at,
        updated_by: status === "missing" ? null : row.author,
      };
      return [language, localized];
    }),
  ) as Record<ContentLanguage, GrammarLocalizedContent>;

  return {
    ...row,
    keywords: curriculumTopic?.keywords ?? [],
    prerequisites,
    related,
    content,
    adaptations: adaptationsFor(row),
  };
}

/** What the mock "Generate with AI" run produces, step by step. */
export const generationSteps = [
  { key: "rule", label: "Core rule" },
  { key: "formula", label: "Formula" },
  { key: "examples", label: "Examples" },
  { key: "mistakes", label: "Common mistakes" },
  { key: "exceptions", label: "Exceptions" },
  { key: "tips", label: "Tips" },
  { key: "uz", label: "Uzbek explanation" },
  { key: "en", label: "English explanation" },
  { key: "ru", label: "Russian explanation" },
  { key: "practice", label: "Practice questions" },
] as const;
