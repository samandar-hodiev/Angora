/**
 * Everything the realtime coach's UI needs that is not React: who the coach is, the
 * conversation modes, the feedback languages, and the topics shown when the library has
 * none published yet.
 */

/**
 * How a coach is drawn. Today: a rigged 3D model. Later, a photoreal streaming video avatar
 * (`video`) behind the same stage — the persona says which, the stage picks the renderer.
 */
export type CoachRenderer =
  | {
      kind: "3d";
      model: string;
      body: "F" | "M";
      /**
       * Test-only models are licensed for non-commercial use, so they open only for the
       * accounts in NEXT_PUBLIC_COACH_TESTERS and never for learners at large.
       */
      testOnly?: boolean;
    }
  | { kind: "video"; provider: string; avatarId: string };

export interface CoachPersona {
  id: string;
  name: string;
  accent: string;
  /** BCP-47 tag for the voice. */
  voiceLang: string;
  vibe: string;
  renderer: CoachRenderer;
}

/*
 * Emma's model (/coach/mpfb.glb) is a MakeHuman (MPFB) character released as CC0, safe for a
 * commercial product. Daniel, Sofia and Mia use TalkingHead's sample avatars (Avatar SDK,
 * Ready Player Me, Avaturn) from /coach/test/, which are non-commercial: they are for trying
 * the coach out and must be replaced by licensed models (or a video avatar) before launch.
 */
export const PERSONAS: CoachPersona[] = [
  {
    id: "emma",
    name: "Emma",
    accent: "British",
    voiceLang: "en-GB",
    vibe: "Warm and patient",
    renderer: { kind: "3d", model: "/coach/mpfb.glb", body: "F" },
  },
  {
    id: "daniel",
    name: "Daniel",
    accent: "American",
    voiceLang: "en-US",
    vibe: "Direct, exam-focused",
    renderer: { kind: "3d", model: "/coach/test/avatarsdk.glb", body: "M", testOnly: true },
  },
  {
    id: "sofia",
    name: "Sofia",
    accent: "Australian",
    voiceLang: "en-AU",
    vibe: "Chatty and curious",
    renderer: { kind: "3d", model: "/coach/test/brunette.glb", body: "F", testOnly: true },
  },
  {
    id: "mia",
    name: "Mia",
    accent: "Canadian",
    voiceLang: "en-CA",
    vibe: "Calm, asks deep questions",
    renderer: { kind: "3d", model: "/coach/test/avaturn.glb", body: "F", testOnly: true },
  },
];

/** Whether this account may talk to this coach. */
export function canUseCoach(persona: CoachPersona, email: string | undefined, testers: string[]) {
  if (persona.renderer.kind !== "3d" || !persona.renderer.testOnly) return true;
  return Boolean(email && testers.includes(email.toLowerCase()));
}

export type CoachMode = "free" | "part1" | "part2" | "part3";

export const MODES: { value: CoachMode; label: string; hint: string }[] = [
  { value: "free", label: "Free talk", hint: "A relaxed conversation, corrections as you go" },
  { value: "part1", label: "IELTS Part 1", hint: "Short questions about you, 4–5 minutes" },
  { value: "part2", label: "Part 2 · Cue card", hint: "1 minute to prepare, 2 minutes to talk" },
  { value: "part3", label: "Part 3 · Discussion", hint: "Abstract follow-ups, opinions and reasons" },
];

/**
 * The language the coach corrects and explains in. Questions stay in English — it is English
 * practice — but "this part was wrong, say it like this" lands better in the learner's own
 * language at lower levels.
 */
export type FeedbackLang = "en" | "uz";

export const FEEDBACK_LANGS: { value: FeedbackLang; label: string; flag: string; voice: string }[] = [
  { value: "en", label: "English", flag: "🇬🇧", voice: "en-GB" },
  { value: "uz", label: "O'zbekcha", flag: "🇺🇿", voice: "uz-UZ" },
];

export interface CoachTopic {
  id: string;
  title: string;
  level: string | null;
  topic: string | null;
}

/** Shown when the library has nothing published yet, so the screen is never empty. */
export const DEMO_TOPICS: CoachTopic[] = [
  { id: "demo-hometown", title: "Describe your hometown", level: "B1", topic: "daily-life" },
  { id: "demo-trip", title: "Talk about a memorable trip", level: "B1", topic: "travel" },
  { id: "demo-job", title: "Your ideal job", level: "B2", topic: "work" },
  { id: "demo-book", title: "Describe a book you enjoyed", level: "B2", topic: "education" },
  { id: "demo-tech", title: "Technology in everyday life", level: "B2", topic: "technology" },
  { id: "demo-food", title: "Food from your country", level: "A2", topic: "food" },
];
