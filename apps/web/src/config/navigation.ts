import {
  BookOpen,
  ChartLine,
  CreditCard,
  GraduationCap,
  History,
  House,
  ListChecks,
  Settings,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * App structure (not learning content). Learning skills are NOT listed here: they come
 * from GET /api/v1/learning/skills, so a new skill added in the database appears in the
 * app without a frontend change.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const primaryNav: NavItem[] = [
  { href: "/app/dashboard", label: "Home", icon: House },
  { href: "/app/learn", label: "Learn", icon: BookOpen },
  { href: "/app/ai-coach", label: "AI Coach", icon: Sparkles },
  { href: "/app/ielts", label: "IELTS", icon: GraduationCap },
  { href: "/app/progress", label: "Progress", icon: ChartLine },
  { href: "/app/mistakes", label: "Mistakes", icon: ListChecks },
  { href: "/app/history", label: "History", icon: History },
];

export const accountNav: NavItem[] = [
  { href: "/app/subscription", label: "Subscription", icon: CreditCard },
  { href: "/app/settings", label: "Settings", icon: Settings },
  { href: "/app/profile", label: "Profile", icon: UserRound },
];

/** Bottom navigation on small screens: the five most-used destinations. */
export const mobileNav: NavItem[] = [
  { href: "/app/dashboard", label: "Home", icon: House },
  { href: "/app/learn", label: "Learn", icon: BookOpen },
  { href: "/app/ai-coach", label: "Coach", icon: Sparkles },
  { href: "/app/progress", label: "Progress", icon: ChartLine },
  { href: "/app/profile", label: "Profile", icon: UserRound },
];

export interface PlannedArea {
  title: string;
  description: string;
  phase: string;
  /** Entitlement required to use the area once it ships (from the subscriptions API). */
  entitlement?: string;
}

/** Areas whose UI ships in later phases (docs/product/roadmap.md). */
export const plannedAreas: Record<string, PlannedArea> = {
  "ai-coach": {
    title: "AI Coach",
    description: "A coach that knows your mistakes, goals and progress and tells you what to practise next.",
    phase: "Phase 7",
    entitlement: "ai_coach.chat",
  },
  ielts: {
    title: "IELTS",
    description: "IELTS preparation and mock exams, built on the same practice engine.",
    phase: "Phase 8",
    entitlement: "ielts.mode",
  },
  progress: {
    title: "Progress",
    description: "Skill scores, trends and time spent, synced across web and mobile.",
    phase: "Phase 6",
  },
  mistakes: {
    title: "Mistakes",
    description: "Your recurring mistakes, grouped and linked to targeted practice.",
    phase: "Phase 6",
  },
  history: {
    title: "History",
    description: "Every session, submission and attempt in one timeline.",
    phase: "Phase 6",
  },
};

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
