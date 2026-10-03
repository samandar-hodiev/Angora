import {
  BookOpen,
  BookOpenCheck,
  BookOpenText,
  Headphones,
  LayoutGrid,
  Mic,
  PenLine,
  ChartLine,
  GraduationCap,
  House,
  ListChecks,
  Settings,
  Sparkles,
  SpellCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * App structure (not content). The skills under "Skills" come from GET /api/v1/learning/skills,
 * so a skill added in the database appears without a frontend release.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const homeNav: NavItem = { href: "/app/dashboard", label: "Home", icon: House };
/** Its own section rather than a skill under Learn: grammar is a library, not a practice queue. */
export const grammarNav: NavItem = { href: "/app/grammar", label: "Grammar", icon: BookOpenCheck };
/**
 * The four practice skills, grouped: in the sidebar a tree that opens on demand, its first
 * row the overview page that used to be "Learn".
 */
export const learnNav: NavItem = { href: "/app/learn", label: "Skills", icon: BookOpen };
export const learnOverviewNav: NavItem = { href: "/app/learn", label: "Overview", icon: LayoutGrid };

/** Each skill's own icon in the sidebar, by skill code; anything else uses the Skills icon. */
export const skillIcons: Record<string, LucideIcon> = {
  speaking: Mic,
  writing: PenLine,
  reading: BookOpenText,
  listening: Headphones,
};

export const primaryNav: NavItem[] = [
  { href: "/app/ielts", label: "IELTS", icon: GraduationCap },
  { href: "/app/ai-coach", label: "AI Coach", icon: Sparkles },
  { href: "/app/vocabulary", label: "Vocabulary", icon: SpellCheck },
  { href: "/app/progress", label: "Progress", icon: ChartLine },
  { href: "/app/mistakes", label: "Mistakes", icon: ListChecks },
];

export const secondaryNav: NavItem[] = [
  { href: "/app/settings", label: "Settings", icon: Settings },
  { href: "/app/profile", label: "Profile", icon: UserRound },
];

/** Bottom navigation on small screens (mirrors the planned mobile app tabs). */
export const mobileNav: NavItem[] = [
  homeNav,
  learnNav,
  { href: "/app/ai-coach", label: "Coach", icon: Sparkles },
  { href: "/app/progress", label: "Progress", icon: ChartLine },
  { href: "/app/profile", label: "Profile", icon: UserRound },
];

/** Skills with a dedicated practice page. Other API skills use /app/learn/[code]. */
const skillRoutes: Record<string, string> = {
  speaking: "/app/speaking",
  writing: "/app/writing",
  reading: "/app/reading",
  listening: "/app/listening",
  vocabulary: "/app/vocabulary",
  grammar: "/app/grammar",
  pronunciation: "/app/pronunciation",
};

export function skillHref(code: string): string {
  return skillRoutes[code] ?? `/app/learn/${code}`;
}

/** Content items open inside their skill's page. */
export function contentHref(skill: string | null, contentId: string): string {
  return `${skill ? skillHref(skill) : "/app/learn"}?content=${contentId}`;
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
