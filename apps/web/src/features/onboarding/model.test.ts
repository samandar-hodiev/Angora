import { describe, expect, it } from "vitest";

import { canContinue, initialAnswers, recommendedToday, toggleSkill, toProfileUpdate, UNSURE_LEVEL } from "./model";

describe("onboarding model", () => {
  it("requires an answer before continuing", () => {
    expect(canContinue("goal", initialAnswers)).toBe(false);
    expect(canContinue("goal", { ...initialAnswers, goal: "ielts" })).toBe(true);
    expect(canContinue("skills", { ...initialAnswers, skills: [] })).toBe(false);
    expect(canContinue("time", { ...initialAnswers, dailyMinutes: 30 })).toBe(true);
  });

  it("toggles skills for multiple selection", () => {
    expect(toggleSkill(["speaking"], "grammar")).toEqual(["speaking", "grammar"]);
    expect(toggleSkill(["speaking", "grammar"], "speaking")).toEqual(["grammar"]);
  });

  it("builds the profile update that completes onboarding", () => {
    const update = toProfileUpdate({ goal: "speak_confidently", level: "B1", skills: ["speaking", "grammar"], dailyMinutes: 30 });
    expect(update).toEqual({
      learning_goals: ["speak_confidently"],
      current_level: "B1",
      daily_goal_minutes: 30,
      preferences: { focus_skills: ["speaking", "grammar"], placement_test_requested: false },
      complete_onboarding: true,
    });
  });

  it("does not guess a level when the learner is unsure", () => {
    const update = toProfileUpdate({ goal: "ielts", level: UNSURE_LEVEL, skills: ["writing"], dailyMinutes: 20 });
    expect(update.current_level).toBeUndefined();
    expect(update.preferences).toMatchObject({ placement_test_requested: true });
  });

  it("recommends up to three focus skills in catalogue order", () => {
    const order = ["speaking", "writing", "reading", "listening", "grammar", "vocabulary", "pronunciation"];
    expect(recommendedToday(["pronunciation", "grammar", "speaking", "vocabulary"], order)).toEqual(["speaking", "grammar", "vocabulary"]);
  });
});
