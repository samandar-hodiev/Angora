/**
 * Mock learner records.
 *
 * Realistic on purpose: the table has to be judged on the shapes it will really hold — long
 * names, missing phone numbers, learners who never came back — not on placeholder rows.
 */

import type {
  CEFRLevel,
  Learner,
  LearnerActivity,
  LearnerDetail,
  LearnerWeakness,
  PlanCode,
  SkillProgress,
} from "../types";
import { MOCK_TODAY, between, daysBetween, mockId, pick, seedFrom, seededRandom, timestampOffset } from "../lib/mock";
import { skillLabels } from "../lib/format";

/** Uzbek names carry gender in the surname ending, so the two halves are picked together. */
const femaleNames = [
  "Dilnoza", "Malika", "Nilufar", "Kamila", "Sevara", "Zilola", "Madina", "Gulnora",
  "Nodira", "Laylo", "Feruza", "Dildora", "Anastasia", "Yulduz", "Nargiza", "Oygul",
];

const maleNames = [
  "Javohir", "Sardor", "Bekzod", "Otabek", "Rustam", "Aziz", "Farrux", "Shahzod",
  "Temur", "Jasur", "Alisher", "Ulugbek", "Timur", "Doniyor", "Sanjar", "Bobur",
];

const surnameRoots = [
  "Karimov", "Tursunov", "Yusupov", "Rahimov", "Abdullayev", "Ismoilov", "Ergashev",
  "Nazarov", "Qodirov", "Olimov", "Saidov", "Mirzayev", "Hamidov", "Yo'ldoshev",
  "Sobirov", "Aliyev", "Xolmatov", "Usmonov", "Zokirov", "Sharipov",
];

const goals = [
  "IELTS 7.0 for a UK master's programme",
  "Speak confidently in daily work meetings",
  "Pass a technical interview in English",
  "Study abroad in Canada next autumn",
  "Write clearer business emails",
  "Get to B2 before graduation",
];

const countries = ["Uzbekistan", "Uzbekistan", "Uzbekistan", "Kazakhstan", "Russia", "Turkey"];
const nativeLanguages = ["Uzbek", "Uzbek", "Uzbek", "Russian", "Karakalpak", "Tajik"];
const levels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const LEARNER_COUNT = 64;

function planFor(random: () => number): PlanCode {
  const roll = random();
  if (roll > 0.94) return "unlimited";
  if (roll > 0.78) return "premium";
  return "free";
}

function buildLearner(index: number): Learner {
  const random = seededRandom(seedFrom(`learner:${index}`));
  const female = random() > 0.48;
  const first = pick(random, female ? femaleNames : maleNames);
  const root = pick(random, surnameRoots);
  const last = female ? `${root}a` : root;
  const name = `${first} ${last}`;
  const plan = planFor(random);
  const joinedDaysAgo = between(random, 1, 400);
  const lastActiveDaysAgo = Math.min(joinedDaysAgo, between(random, 0, 45));
  const statusRoll = random();
  const status =
    statusRoll > 0.96 ? "suspended" : statusRoll > 0.92 ? "pending" : statusRoll > 0.9 ? "archived" : "active";

  return {
    id: mockId("learner", index),
    name,
    email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}${index}@${pick(random, [
      "gmail.com",
      "gmail.com",
      "mail.ru",
      "outlook.com",
    ])}`,
    phone: random() > 0.22 ? `+998 ${between(random, 33, 99)} ${between(random, 100, 999)} ${between(random, 10, 99)} ${between(random, 10, 99)}` : null,
    age: random() > 0.12 ? between(random, 15, 41) : null,
    avatar_url: null,
    level: pick(random, levels),
    plan,
    status,
    country: pick(random, countries),
    joined_at: timestampOffset(joinedDaysAgo, between(random, 7, 21), between(random, 0, 59)),
    last_active_at: timestampOffset(lastActiveDaysAgo, between(random, 6, 22), between(random, 0, 59)),
    streak_days: status === "active" && lastActiveDaysAgo < 2 ? between(random, 1, 74) : 0,
    lessons_completed: between(random, 0, 420),
  };
}

export const learners: Learner[] = Array.from({ length: LEARNER_COUNT }, (_, i) => buildLearner(i));

/** Newest first — what the dashboard's "recent registrations" card shows. */
export const learnersByJoined = [...learners].sort((a, b) => b.joined_at.localeCompare(a.joined_at));

const weaknessTopics: Record<string, string> = {
  grammar: "Present Perfect vs Past Simple",
  speaking: "Linking words in long turns",
  writing: "Task 2 paragraph structure",
  reading: "Skimming for gist under time",
  listening: "Fast connected speech",
  vocabulary: "Academic collocations",
  ielts: "Speaking part 3 development",
};

export function buildLearnerDetail(learner: Learner): LearnerDetail {
  const random = seededRandom(seedFrom(`detail:${learner.id}`));
  const base = levels.indexOf(learner.level);

  const skills: SkillProgress[] = (Object.keys(skillLabels) as (keyof typeof skillLabels)[]).map((skill) => {
    const mastery = Math.min(98, Math.max(4, between(random, 18, 88) + (learner.plan === "free" ? -8 : 6)));
    return {
      skill,
      label: skillLabels[skill],
      mastery,
      level: levels[Math.max(0, Math.min(5, base + (mastery > 70 ? 1 : mastery < 35 ? -1 : 0)))]!,
      sessions: between(random, 0, 90),
      last_activity_at: random() > 0.15 ? timestampOffset(between(random, 0, 30), 18, 20) : null,
    };
  });

  const weaknesses: LearnerWeakness[] = Object.entries(weaknessTopics)
    .slice(0, 4)
    .map(([skill, topic]) => ({
      topic,
      skill: skill as LearnerWeakness["skill"],
      accuracy: between(random, 32, 68),
      attempts: between(random, 4, 40),
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const activityKinds: LearnerActivity["kind"][] = ["grammar", "speaking", "writing", "reading", "listening", "auth"];
  const activity: LearnerActivity[] = Array.from({ length: 8 }, (_, i) => {
    const kind = pick(random, activityKinds);
    return {
      id: mockId(`activity:${learner.id}`, i),
      kind,
      title:
        kind === "auth"
          ? "Signed in"
          : `Completed ${kind === "grammar" ? "a grammar practice set" : `a ${kind} session`}`,
      detail:
        kind === "auth"
          ? `Web · ${learner.country}`
          : `${between(random, 4, 20)} min · score ${between(random, 55, 98)}%`,
      created_at: timestampOffset(i * 1.5 + random(), between(random, 7, 22), between(random, 0, 59)),
    };
  });

  const startedDays = daysBetween(learner.joined_at.slice(0, 10), MOCK_TODAY);

  return {
    ...learner,
    goal: pick(random, goals),
    native_language: pick(random, nativeLanguages),
    minutes_this_week: learner.status === "active" ? between(random, 0, 310) : 0,
    overall_mastery: Math.round(skills.reduce((t, s) => t + s.mastery, 0) / skills.length),
    skills,
    weaknesses,
    activity,
    subscription: {
      plan: learner.plan,
      status: learner.plan === "free" ? "free" : learner.status === "suspended" ? "past_due" : "active",
      started_at: learner.joined_at,
      renews_at: learner.plan === "free" ? null : timestampOffset(-between(random, 2, 28), 12, 0),
      amount_cents: learner.plan === "premium" ? 1200 : learner.plan === "unlimited" ? 2900 : 0,
      currency: "USD",
      provider: learner.plan === "free" ? "none" : pick(random, ["click", "payme", "stripe"]),
      history:
        learner.plan === "free"
          ? []
          : [
              {
                id: mockId(`plan:${learner.id}`, 1),
                from_plan: "free" as PlanCode,
                to_plan: learner.plan === "unlimited" ? ("premium" as PlanCode) : learner.plan,
                changed_at: timestampOffset(Math.max(1, startedDays - between(random, 5, 60)), 14, 0),
              },
              ...(learner.plan === "unlimited"
                ? [
                    {
                      id: mockId(`plan:${learner.id}`, 2),
                      from_plan: "premium" as PlanCode,
                      to_plan: "unlimited" as PlanCode,
                      changed_at: timestampOffset(between(random, 3, 40), 14, 0),
                    },
                  ]
                : []),
            ],
    },
  };
}
