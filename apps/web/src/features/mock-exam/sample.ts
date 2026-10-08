/**
 * Mock exam — the shapes the screens are drawn against, and sample content to draw them with.
 *
 * This is UI only for now: nothing here comes from the API yet. When the backend lands, the
 * types stay and the sample data goes; the screens read the same shapes from a query.
 */

export type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type MockSkill = "listening" | "reading" | "writing" | "speaking";

export const mockSkills: MockSkill[] = ["listening", "reading", "writing", "speaking"];

export const mockSkillLabels: Record<MockSkill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
};

export type MockQuestion =
  | { id: string; kind: "choice"; prompt: string; options: string[] }
  | { id: string; kind: "true_false"; prompt: string }
  | { id: string; kind: "gap"; prompt: string };

export interface MockSection {
  skill: MockSkill;
  level: CEFRLevel;
  title: string;
  /** Whole minutes the section allows; the timer starts on Start and the section locks at zero. */
  minutes: number;
  instructions: string;
  /** Reading: the passage. Listening: the audio's length in seconds, played once. */
  passage?: { title: string; paragraphs: string[] };
  audioSeconds?: number;
  questions?: MockQuestion[];
  /** Writing: the task and the fewest words it expects. */
  task?: { prompt: string; minWords: number };
  /** Speaking: the cue card, the seconds to prepare and the seconds to speak. */
  cueCard?: { topic: string; points: string[]; prepSeconds: number; speakSeconds: number };
}

/** Section lengths grow with the level, as a real exam's do. */
const minutesByLevel: Record<CEFRLevel, Record<MockSkill, number>> = {
  A1: { listening: 15, reading: 20, writing: 20, speaking: 6 },
  A2: { listening: 20, reading: 25, writing: 25, speaking: 8 },
  B1: { listening: 25, reading: 35, writing: 35, speaking: 10 },
  B2: { listening: 30, reading: 45, writing: 40, speaking: 12 },
  C1: { listening: 30, reading: 60, writing: 50, speaking: 14 },
  C2: { listening: 35, reading: 60, writing: 60, speaking: 15 },
};

const minWordsByLevel: Record<CEFRLevel, number> = { A1: 50, A2: 80, B1: 120, B2: 180, C1: 220, C2: 250 };

export function sampleSection(skill: MockSkill, level: CEFRLevel): MockSection {
  const minutes = minutesByLevel[level][skill];
  switch (skill) {
    case "reading":
      return {
        skill,
        level,
        minutes,
        title: "Reading · Part 1",
        instructions: "Read the passage and answer the questions. You can move between questions at any time.",
        passage: {
          title: "The city that cycles",
          paragraphs: [
            "Twenty years ago, few people in the city rode a bicycle to work. The roads were busy, the air was dirty and there was nowhere safe to leave a bike. Today almost half of all journeys to work are made by bicycle.",
            "The change began with a small decision. The city closed one main street to cars on Sundays. Families came to ride, children learned to cycle, and shops on the street did more business than before.",
            "After that, the city built protected lanes, hundreds of bike racks and a cheap bike-sharing scheme. Not everyone was happy at first: some drivers complained that their trips took longer. But traffic accidents fell, and so did pollution.",
            "Other cities now send planners to learn from the experience. The lesson, they say, is not about bicycles at all — it is about making the easy choice the healthy one.",
          ],
        },
        questions: [
          { id: "r1", kind: "choice", prompt: "How many journeys to work are made by bicycle today?", options: ["Very few", "About a quarter", "Almost half", "Nearly all"] },
          { id: "r2", kind: "choice", prompt: "What was the city's first step?", options: ["Building bike lanes", "Closing a street to cars on Sundays", "Opening a bike-sharing scheme", "Raising the price of parking"] },
          { id: "r3", kind: "true_false", prompt: "Shops on the closed street lost customers." },
          { id: "r4", kind: "true_false", prompt: "Some drivers were unhappy with the changes at first." },
          { id: "r5", kind: "gap", prompt: "After the changes, traffic accidents and ________ both fell." },
          { id: "r6", kind: "choice", prompt: "According to the planners, the main lesson is about…", options: ["bicycles", "making healthy choices easy", "closing streets", "saving money"] },
        ],
      };
    case "listening":
      return {
        skill,
        level,
        minutes,
        title: "Listening · Section 1",
        instructions: "You will hear the recording once only. Read the questions first, then press Play. Answer as you listen.",
        audioSeconds: 150,
        questions: [
          { id: "l1", kind: "gap", prompt: "The caller wants to book a room for ________ nights." },
          { id: "l2", kind: "choice", prompt: "Which room does the caller choose?", options: ["Single", "Double", "Family room", "Suite"] },
          { id: "l3", kind: "gap", prompt: "Breakfast is served from ________ a.m." },
          { id: "l4", kind: "true_false", prompt: "The hotel has free parking." },
          { id: "l5", kind: "choice", prompt: "How will the caller pay?", options: ["Cash on arrival", "Credit card now", "Bank transfer", "At check-out by card"] },
          { id: "l6", kind: "gap", prompt: "The caller's surname is spelled ________." },
        ],
      };
    case "writing":
      return {
        skill,
        level,
        minutes,
        title: "Writing · Task",
        instructions: "Write your answer in the box. Copying and pasting are turned off. When the time runs out, writing stops and your answer is submitted as it is.",
        task: {
          prompt:
            "Some people think that cities should close their centres to cars. Others believe this would hurt local shops and businesses. Discuss both views and give your own opinion.",
          minWords: minWordsByLevel[level],
        },
      };
    case "speaking":
      return {
        skill,
        level,
        minutes,
        title: "Speaking · Long turn",
        instructions: "Read the card. You have time to prepare and may make notes. Then press Record and speak until the time is up.",
        cueCard: {
          topic: "Describe a place in your city that you like to visit.",
          points: ["where it is", "how often you go there", "what you do there", "and explain why you like it"],
          prepSeconds: 60,
          speakSeconds: 120,
        },
      };
  }
}

/** One mock exam as the owner sees it in the console. */
export interface MockSet {
  id: string;
  level: CEFRLevel;
  skill: MockSkill;
  title: string;
  questions: number;
  minutes: number;
  status: "draft" | "published";
  source: "ai" | "manual";
  updatedAt: string;
}

export function sampleSets(): MockSet[] {
  const sets: MockSet[] = [];
  const levels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  for (const level of levels) {
    for (const skill of mockSkills) {
      const section = sampleSection(skill, level);
      const count = level === "A2" || level === "B1" ? 2 : level === "C2" ? 0 : 1;
      for (let i = 1; i <= count; i++) {
        sets.push({
          id: `${level}-${skill}-${i}`,
          level,
          skill,
          title: `${level} ${mockSkillLabels[skill]} · Mock ${i}`,
          questions: section.questions?.length ?? 1,
          minutes: section.minutes,
          status: i === 1 ? "published" : "draft",
          source: "ai",
          updatedAt: "2026-10-07T12:00:00Z",
        });
      }
    }
  }
  return sets;
}
