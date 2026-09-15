import {
  BookOpen,
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
 * App structure (not content). Skills under "Learn" come from GET /api/v1/learning/skills,
 * so a skill added in the database appears without a frontend release.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const homeNav: NavItem = { href: "/app/dashboard", label: "Home", icon: House };
export const learnNav: NavItem = { href: "/app/learn", label: "Learn", icon: BookOpen };

export const primaryNav: NavItem[] = [
  { href: "/app/ai-coach", label: "AI Coach", icon: Sparkles },
  { href: "/app/ielts", label: "IELTS", icon: GraduationCap },
  { href: "/app/progress", label: "Progress", icon: ChartLine },
  { href: "/app/vocabulary", label: "Vocabulary", icon: SpellCheck },
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
