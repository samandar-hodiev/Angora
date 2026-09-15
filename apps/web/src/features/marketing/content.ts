import {
  BarChart3,
  BrainCircuit,
  GraduationCap,
  MessageSquareText,
  Mic,
  RefreshCcw,
  Target,
  type LucideIcon,
} from "lucide-react";

/**
 * Marketing copy for the public website. This is product messaging, not learning content:
 * lessons, topics and exercises always come from the API.
 */

export const marketingNav = [
  { href: "/features", label: "Features" },
  { href: "/ielts", label: "IELTS" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

export const learningLoop: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Mic, title: "Practice", text: "Speak, write, read and listen on real topics at your level." },
  { icon: BrainCircuit, title: "AI analysis", text: "Every answer is analysed for grammar, vocabulary, fluency and pronunciation." },
  { icon: MessageSquareText, title: "Feedback", text: "Clear corrections and explanations — not just a number." },
  { icon: Target, title: "Weak spots", text: "Recurring mistakes are detected and turned into focus areas." },
  { icon: RefreshCcw, title: "Personal practice", text: "Your next exercises target exactly what holds you back." },
  { icon: BarChart3, title: "Progress", text: "Watch each skill improve, on the web today and on mobile next." },
];

export interface SkillMarketing {
  code: "speaking" | "writing" | "reading" | "listening";
  title: string;
  headline: string;
  description: string;
  points: string[];
  steps: { title: string; text: string }[];
}

export const skillsMarketing: SkillMarketing[] = [
  {
    code: "speaking",
    title: "Speaking",
    headline: "Speak with confidence, get feedback in minutes.",
    description: "Answer real questions out loud and see exactly what to improve in fluency, grammar, vocabulary and pronunciation.",
    points: ["Topics matched to your level", "Fluency, grammar and vocabulary feedback", "Pronunciation issues you can replay", "Estimated IELTS band when you need it"],
    steps: [
      { title: "Choose a topic", text: "Pick a question at your level, or take the one your coach recommends." },
      { title: "Record your answer", text: "Speak for up to two minutes. Pause whenever you need." },
      { title: "Review your analysis", text: "See scores, corrected sentences and what to practise next." },
    ],
  },
  {
    code: "writing",
    title: "Writing",
    headline: "Write clearly. Understand every correction.",
    description: "Essays, emails and exam tasks with feedback that explains the rule behind each change.",
    points: ["Distraction-free editor with word count", "Inline corrections with explanations", "Structure and coherence feedback", "Exam mode without AI hints"],
    steps: [
      { title: "Pick a task", text: "From a quick email to an IELTS Task 2 essay." },
      { title: "Write in focus", text: "A calm editor keeps your attention on the text." },
      { title: "Learn from feedback", text: "Every mistake links to the grammar or vocabulary behind it." },
    ],
  },
  {
    code: "reading",
    title: "Reading",
    headline: "Read more. Understand more.",
    description: "Passages at your level with questions beside the text, so you never lose your place.",
    points: ["Comfortable typography for long reads", "Questions next to the passage", "New words saved to your deck", "Progress tracked by level"],
    steps: [
      { title: "Open a passage", text: "Real-world topics, written for your level." },
      { title: "Answer as you read", text: "Questions stay visible beside the article." },
      { title: "Grow your vocabulary", text: "Unknown words become spaced-repetition cards." },
    ],
  },
  {
    code: "listening",
    title: "Listening",
    headline: "Train your ear for real English.",
    description: "Conversations and talks with focused questions. Transcripts appear only when they help.",
    points: ["Clean, simple audio player", "Questions while you listen", "Transcript after you answer", "Everyday and exam-style audio"],
    steps: [
      { title: "Press play", text: "Listen to a short conversation or talk." },
      { title: "Answer questions", text: "Focus on meaning, not subtitles." },
      { title: "Check the transcript", text: "See what you missed once you've answered." },
    ],
  },
];

export const featureGroups: { title: string; items: { title: string; text: string }[] }[] = [
  {
    title: "Practice every skill",
    items: [
      { title: "Speaking", text: "Record answers and receive structured analysis." },
      { title: "Writing", text: "Focused editor with explained corrections." },
      { title: "Reading", text: "Level-matched passages with side-by-side questions." },
      { title: "Listening", text: "Audio exercises with questions and transcripts." },
      { title: "Vocabulary", text: "Spaced repetition with pronunciation and examples." },
      { title: "Grammar", text: "Topics ranked by your own mistakes." },
    ],
  },
  {
    title: "Learn from AI that knows you",
    items: [
      { title: "AI Coach", text: "Knows your goals, mistakes and progress, and tells you what to do today." },
      { title: "Mistake tracking", text: "Recurring errors are grouped so you fix patterns, not single slips." },
      { title: "Personal learning plan", text: "Daily practice built around your goal, level and time." },
    ],
  },
  {
    title: "See yourself improve",
    items: [
      { title: "Skill scores", text: "One clear score per skill, updated as you practise." },
      { title: "Streaks and goals", text: "Gentle daily goals that fit your schedule." },
      { title: "IELTS preparation", text: "Estimated band scores and full mock exams when you need them." },
    ],
  },
];

export const faqs: { question: string; answer: string }[] = [
  {
    question: "Who is Engora for?",
    answer:
      "Anyone improving their English — for work, study, travel or confidence. IELTS preparation is available as a dedicated mode, but you don't need an exam goal to use Engora.",
  },
  {
    question: "How does the AI feedback work?",
    answer:
      "When you submit a spoken or written answer, Engora analyses it for grammar, vocabulary, fluency and pronunciation, then returns corrections, explanations and recommended next practice.",
  },
  {
    question: "Are IELTS scores official?",
    answer:
      "No. Engora shows estimated band scores to help you prepare. Only an official IELTS test provides an official score.",
  },
  {
    question: "Can I use Engora on my phone?",
    answer:
      "The web app works on mobile browsers today. Native iOS and Android apps are planned and will use the same account, progress and subscription.",
  },
  {
    question: "Is there a free plan?",
    answer: "Yes. The free plan includes practice in every core skill with a daily allowance of AI evaluations.",
  },
  {
    question: "What happens to my recordings?",
    answer:
      "Recordings are stored securely and used to give you feedback. You stay in control of your data and can request its deletion.",
  },
];

export const ieltsHighlights: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Mic, title: "Speaking test practice", text: "Part 1, 2 and 3 style questions with timed answers." },
  { icon: MessageSquareText, title: "Writing Task 1 & 2", text: "Band-descriptor-based feedback on every essay." },
  { icon: GraduationCap, title: "Full mock exams", text: "A focused exam mode with no hints and a real timer." },
];

export const ieltsDisclaimer =
  "IELTS is a registered trademark of the University of Cambridge, the British Council and IDP Education. Engora is not affiliated with or endorsed by them. Scores shown in Engora are estimates.";
