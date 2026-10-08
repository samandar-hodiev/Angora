/**
 * Everything the realtime coach's UI needs that is not React: who the coach looks like, the
 * conversation modes, and — until the realtime backend lands — the scripted conversation
 * the preview plays through.
 *
 * The script is deliberately plain. It exists to put every state of the screen in front of
 * someone (coach speaking, your turn, listening, thinking, feedback, summary) and nothing it
 * says should be mistaken for the model's judgement; the stage is badged "Preview" for that
 * reason.
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

type Localized = Record<FeedbackLang, string>;

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

export interface ScriptTurn {
  question: string;
  /** What the preview "hears" you say — a stand-in for the realtime transcript. */
  sampleAnswer: string;
  feedback: {
    tone: "good" | "fix";
    original?: string;
    better?: string;
    /** The written explanation in the feedback panel. */
    note: Localized;
    /** What the coach says out loud before the next question. */
    spoken: Localized;
  };
  suggestions: string[];
}

export function buildScript(topic: CoachTopic | null, persona: CoachPersona, mode: CoachMode): ScriptTurn[] {
  const subject = topic?.title ?? "anything you like";
  const lower = subject.charAt(0).toLowerCase() + subject.slice(1);
  const opener =
    mode === "part2"
      ? `Here is your cue card: “${subject}”. You have one minute to think, then talk for up to two minutes. Ready when you are.`
      : topic
        ? `Hi, I'm ${persona.name}! Today we'll talk about this: ${lower}. Let's warm up — what's the first thing that comes to mind?`
        : `Hi, I'm ${persona.name}! No fixed topic today — so tell me, how has your week been so far?`;

  return [
    {
      question: opener,
      sampleAnswer:
        "Well, honestly the first thing I think about is my childhood, because I was spending a lot of time with my family and it was really important for me.",
      feedback: {
        tone: "fix",
        original: "I was spending a lot of time",
        better: "I spent a lot of time",
        note: {
          en: "For finished habits in the past, simple past sounds more natural.",
          uz: "O'tmishda tugagan odatlar uchun Past Simple tabiiyroq eshitiladi.",
        },
        spoken: {
          en: "Good start! One fix: say “I spent a lot of time”, not “I was spending” — it's a finished habit.",
          uz: "Yaxshi boshladingiz! Bitta xato bor: “I was spending” emas, “I spent a lot of time” deyiladi — bu o'tmishda tugagan odat.",
        },
      },
      suggestions: ["it meant a lot to me", "looking back", "I'd say"],
    },
    {
      question: "Nice start. Can you give me a specific example — a moment you still remember clearly?",
      sampleAnswer:
        "Yes, I remember one summer when we went to the mountains together and it was the first time I saw how beautiful nature can be.",
      feedback: {
        tone: "good",
        note: {
          en: "Great storytelling — a clear time, place and feeling. Try one vivid adjective next time.",
          uz: "Zo'r hikoya — vaqt, joy va his-tuyg'u aniq. Keyingi safar bitta yorqin sifat qo'shib ko'ring.",
        },
        spoken: {
          en: "Lovely — that was a clear little story. No mistakes there!",
          uz: "Ajoyib — juda aniq hikoya bo'ldi. Bu yerda xato yo'q!",
        },
      },
      suggestions: ["breathtaking", "it stuck with me", "to this day"],
    },
    {
      question: "How has the way you think about this changed over the last few years?",
      sampleAnswer:
        "I think now I am more independent, so I am seeing things more different than before, and I value small moments more.",
      feedback: {
        tone: "fix",
        original: "more different",
        better: "quite differently",
        note: {
          en: "“See” needs an adverb, and “different” is already a comparison.",
          uz: "“See” fe'lidan keyin ravish kerak, “different” esa o'zi taqqoslash — “more” ortiqcha.",
        },
        spoken: {
          en: "Nice idea. Small fix: “I see things quite differently”, not “more different”.",
          uz: "Fikr yaxshi. Kichik xato: “more different” emas, “I see things quite differently” deyiladi.",
        },
      },
      suggestions: ["my perspective has shifted", "these days", "I've come to appreciate"],
    },
    {
      question: "Why do you think some people feel quite differently about it?",
      sampleAnswer:
        "Probably because everyone has different background and experience, so it depends on how they grew up and what they care about.",
      feedback: {
        tone: "fix",
        original: "different background",
        better: "a different background",
        note: {
          en: "“Background” is countable here — it needs an article.",
          uz: "Bu yerda “background” sanaladigan ot — oldidan “a” artikli kerak.",
        },
        spoken: {
          en: "Good reasoning. Just add an article: “a different background”.",
          uz: "Mantiq to'g'ri. Faqat artikl tushib qoldi: “a different background” bo'lishi kerak.",
        },
      },
      suggestions: ["it largely depends on", "upbringing", "on the other hand"],
    },
    {
      question: "Last one — if you could change one thing about it, what would it be and why?",
      sampleAnswer:
        "If I could change one thing, I would make more time for it, because nowadays everybody is so busy and we forget what really matters.",
      feedback: {
        tone: "good",
        note: {
          en: "Perfect second conditional, and a strong reason to finish on.",
          uz: "Second conditional to'g'ri ishlatildi va yakuniy fikr kuchli chiqdi.",
        },
        spoken: {
          en: "Perfect second conditional — great way to finish!",
          uz: "Second conditional mukammal ishlatildi — zo'r yakun!",
        },
      },
      suggestions: ["at the end of the day", "what truly matters", "prioritise"],
    },
  ];
}

/** A rough IELTS-style breakdown for the summary screen; the backend will replace it. */
export const PREVIEW_SCORES = [
  { key: "fluency", label: "Fluency & coherence", band: 6.5 },
  { key: "lexical", label: "Lexical resource", band: 6.0 },
  { key: "grammar", label: "Grammatical range & accuracy", band: 6.0 },
  { key: "pronunciation", label: "Pronunciation", band: 7.0 },
] as const;
