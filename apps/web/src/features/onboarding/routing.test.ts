import type { OnboardingState, OnboardingStep } from "@engora/types";
import { describe, expect, it } from "vitest";

import { isJourneyPathAllowed, journeyPath } from "./routing";

function state(step: OnboardingStep, overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    step,
    profile_completed: true,
    level_path: null,
    assessment_id: null,
    goals: [],
    daily_goal_minutes: 20,
    self_reported_level: null,
    placement_start_level: null,
    started_at: null,
    completed_at: null,
    updated_at: "2026-09-15T10:00:00Z",
    options: { goals: [], max_goals: 6, daily_minutes: [10, 20, 30, 45, 60], levels: ["A1", "A2", "B1", "B2", "C1"] },
    ...overrides,
  };
}

describe("journeyPath", () => {
  it("sends new accounts to profile setup before anything else", () => {
    expect(journeyPath(state("NOT_STARTED", { profile_completed: false }))).toBe("/setup-profile");
    expect(journeyPath(state("COMPLETED", { profile_completed: false }))).toBe("/setup-profile");
  });

  it("maps each stage to its own page", () => {
    expect(journeyPath(state("WELCOME"))).toBe("/onboarding");
    expect(journeyPath(state("DAILY_TIME"))).toBe("/onboarding");
    expect(journeyPath(state("LEVEL_SELECTION"))).toBe("/level");
    expect(journeyPath(state("PLACEMENT_START_LEVEL"))).toBe("/level");
    expect(journeyPath(state("PLACEMENT_WRITING", { assessment_id: "a1" }))).toBe("/placement-test/a1");
    expect(journeyPath(state("PLACEMENT_PROCESSING", { assessment_id: "a1" }))).toBe("/placement-test/a1");
    expect(journeyPath(state("PLACEMENT_RESULTS", { assessment_id: "a1" }))).toBe("/assessment-results/a1");
    expect(journeyPath(state("COMPLETED"))).toBe("/app/dashboard");
  });

  it("shows the plan where the level was decided", () => {
    expect(journeyPath(state("PERSONALIZED_PLAN", { level_path: "self_reported" }))).toBe("/level");
    expect(journeyPath(state("PERSONALIZED_PLAN", { level_path: "placement", assessment_id: "a1" }))).toBe("/assessment-results/a1");
  });
});

describe("isJourneyPathAllowed", () => {
  it("keeps unfinished learners on their current step", () => {
    const s = state("PLACEMENT_READING", { assessment_id: "a1" });
    expect(isJourneyPathAllowed(s, "/placement-test/a1")).toBe(true);
    expect(isJourneyPathAllowed(s, "/app/dashboard")).toBe(false);
    expect(isJourneyPathAllowed(s, "/placement-test/other")).toBe(false);
    expect(isJourneyPathAllowed(state("GOAL_SELECTION"), "/level")).toBe(false);
  });

  it("lets finished learners use the app, retake tests and edit their profile", () => {
    const done = state("COMPLETED");
    expect(isJourneyPathAllowed(done, "/app/progress")).toBe(true);
    expect(isJourneyPathAllowed(done, "/assessment-results/a2")).toBe(true);
    expect(isJourneyPathAllowed(done, "/setup-profile")).toBe(true);
    expect(isJourneyPathAllowed(done, "/onboarding")).toBe(false);
  });
});
