import type { OnboardingState } from "@engora/types";

/**
 * Where a signed-in learner belongs in the new-learner journey. The server owns the state
 * (GET /onboarding); this only maps it to web routes, so it is trivially re-implemented by
 * the mobile apps with their own screens.
 *
 *   profile incomplete           → /setup-profile
 *   welcome, goals, daily time   → /onboarding
 *   level choice, test intro     → /level
 *   placement sections, analysis → /placement-test/:id
 *   results (+ plan)             → /assessment-results/:id
 *   completed                    → /app/dashboard
 */
export function journeyPath(state: OnboardingState): string {
  if (!state.profile_completed) return "/setup-profile";
  const id = state.assessment_id;
  switch (state.step) {
    case "COMPLETED":
      return "/app/dashboard";
    case "NOT_STARTED":
    case "WELCOME":
    case "GOAL_SELECTION":
    case "DAILY_TIME":
      return "/onboarding";
    case "LEVEL_SELECTION":
    case "PLACEMENT_INTRO":
    case "PLACEMENT_START_LEVEL":
      return "/level";
    case "PLACEMENT_READING":
    case "PLACEMENT_LISTENING":
    case "PLACEMENT_WRITING":
    case "PLACEMENT_SPEAKING":
    case "PLACEMENT_PROCESSING":
      return id ? `/placement-test/${id}` : "/level";
    case "PLACEMENT_RESULTS":
      return id ? `/assessment-results/${id}` : "/level";
    case "PERSONALIZED_PLAN":
      return state.level_path === "placement" && id ? `/assessment-results/${id}` : "/level";
  }
}

function section(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

/**
 * Whether the learner may stay on `pathname`. Pages of the journey only show the step the
 * server says is current; finished learners can still open assessment pages (retakes from
 * their profile) and edit their profile.
 */
export function isJourneyPathAllowed(state: OnboardingState, pathname: string): boolean {
  const expected = journeyPath(state);
  if (pathname === expected || pathname.startsWith(`${expected}/`)) return true;

  const current = section(pathname);
  if (state.step === "COMPLETED" && state.profile_completed) {
    return current === "app" || current === "placement-test" || current === "assessment-results" || current === "setup-profile";
  }
  return false;
}
