import type { AssessmentArea } from "@engora/types";

/**
 * Display text for product codes returned by the API (goals, levels, skills, criteria). The
 * API stores codes only; each client owns its wording and future translations.
 */

export const goalLabels: Record<string, { label: string; description: string }> = {
  improve_english: { label: "Improve my English", description: "Get better at everyday English." },
  speak_confidently: { label: "Speak more confidently", description: "Feel comfortable in real conversations." },
  ielts: { label: "Prepare for IELTS", description: "Practise exam-style tasks." },
  work: { label: "English for work", description: "Meetings, emails and presentations." },
  university: { label: "English for university", description: "Lectures, reading and academic writing." },
  travel: { label: "English for travel", description: "The conversations you need on the road." },
};

/** Goal label for a stored goal code; older codes fall back to readable text. */
export function goalLabel(code: string): string {
  return goalLabels[code]?.label ?? code.charAt(0).toUpperCase() + code.slice(1).replaceAll("_", " ");
}

export const levelLabels: Record<string, { name: string; description: string }> = {
  A1: { name: "Beginner", description: "I know basic words and simple phrases." },
  A2: { name: "Elementary", description: "I can handle simple, everyday conversations." },
  B1: { name: "Intermediate", description: "I can talk about familiar topics and experiences." },
  B2: { name: "Upper-intermediate", description: "I can discuss many topics with some fluency." },
  C1: { name: "Advanced", description: "I can express myself fluently and precisely." },
  C2: { name: "Proficient", description: "I understand and use English with ease." },
};

export const dailyTimeLabels: Record<number, string> = {
  10: "Light",
  20: "Steady",
  30: "Focused",
  45: "Intensive",
  60: "Deep work",
};

const skillNames: Record<string, string> = {
  reading: "Reading",
  listening: "Listening",
  writing: "Writing",
  speaking: "Speaking",
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  pronunciation: "Pronunciation",
};

const criterionNames: Record<string, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  coherence: "Organisation",
  task_response: "Task response",
  fluency: "Fluency",
  relevance: "Relevance",
  pronunciation: "Pronunciation",
  comprehension: "Comprehension",
};

export function skillName(code: string): string {
  return skillNames[code] ?? code.charAt(0).toUpperCase() + code.slice(1).replaceAll("_", " ");
}

/** The base CEFR code of an estimate ("B1+" → "B1"). */
export function baseLevel(code: string): string {
  return code.replace("+", "");
}

export function areaLabel(area: AssessmentArea): { title: string; context?: string } {
  if (area.type === "skill") return { title: skillName(area.code) };
  const [skill = "", criterion = ""] = area.code.split(".");
  return { title: criterionNames[criterion] ?? skillName(criterion), context: `in ${skillName(skill).toLowerCase()}` };
}
