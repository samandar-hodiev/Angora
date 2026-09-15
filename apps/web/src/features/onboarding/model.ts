import type { ProfileUpdateInput } from "@engora/validation";

/**
 * Onboarding flow logic, kept free of React so it is easy to test and to reuse in the
 * mobile app. Answers are saved to the learner profile through the API, never only in the
 * browser.
 */

export const ONBOARDING_STEPS = ["goal", "level", "skills", "time", "plan"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Goal codes are stored in profiles.learning_goals. */
export const goalOptions = [
  { code: "improve_english", label: "Improve my English" },
  { code: "ielts", label: "Prepare for IELTS" },
  { code: "speak_confidently", label: "Speak confidently" },
  { code: "career", label: "Career & work" },
  { code: "university", label: "University" },
  { code: "travel", label: "Travel" },
  { code: "business", label: "Business English" },
] as const;

export const UNSURE_LEVEL = "unsure";

export const dailyTimeOptions = [
  { minutes: 10, label: "Light" },
  { minutes: 20, label: "Steady" },
  { minutes: 30, label: "Focused" },
  { minutes: 45, label: "Intensive" },
  { minutes: 60, label: "Deep work" },
] as const;

export interface OnboardingAnswers {
  goal: string | null;
  level: string | null;
  skills: string[];
  dailyMinutes: number | null;
}

export const initialAnswers: OnboardingAnswers = { goal: null, level: null, skills: [], dailyMinutes: null };

export function goalLabel(code: string | null | undefined): string {
  return goalOptions.find((g) => g.code === code)?.label ?? "Improve my English";
}

export function canContinue(step: OnboardingStep, answers: OnboardingAnswers): boolean {
  switch (step) {
    case "goal":
      return answers.goal !== null;
    case "level":
      return answers.level !== null;
    case "skills":
      return answers.skills.length > 0;
    case "time":
      return answers.dailyMinutes !== null;
    case "plan":
      return true;
  }
}

export function toggleSkill(skills: string[], code: string): string[] {
  return skills.includes(code) ? skills.filter((s) => s !== code) : [...skills, code];
}

/** The profile update that completes onboarding. */
export function toProfileUpdate(answers: OnboardingAnswers): ProfileUpdateInput {
  const unsure = answers.level === UNSURE_LEVEL;
  return {
    learning_goals: answers.goal ? [answers.goal] : [],
    current_level: unsure || !answers.level ? undefined : answers.level,
    daily_goal_minutes: answers.dailyMinutes ?? undefined,
    preferences: {
      focus_skills: answers.skills,
      placement_test_requested: unsure,
    },
    complete_onboarding: true,
  };
}

/**
 * Today's recommended skills: the learner's focus skills in catalogue order, at most three.
 * Rule-based until the personalization engine produces recommendations.
 */
export function recommendedToday(focusSkills: string[], catalogueOrder: string[]): string[] {
  const rank = (code: string) => {
    const i = catalogueOrder.indexOf(code);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...focusSkills].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}
