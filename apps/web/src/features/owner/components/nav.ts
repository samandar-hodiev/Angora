import {
  BookOpen,
  ClipboardList,
  CreditCard,
  FileStack,
  Headphones,
  LayoutDashboard,
  LineChart,
  Mic,
  PenLine,
  Settings,
  SpellCheck,
  Target,
  Trophy,
  Type,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface OwnerNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Matched with startsWith; exact routes opt out. */
  exact?: boolean;
}

export interface OwnerNavSection {
  label: string;
  items: OwnerNavItem[];
}

/**
 * The console's navigation. Skills link into the CMS with a type filter rather than each
 * getting a route of its own — one content table, pre-filtered, is less to maintain and less
 * for the Owner to learn.
 */
export const ownerNav: OwnerNavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/owner/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/owner/analytics", label: "Analytics", icon: LineChart },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/owner/cms", label: "All content", icon: FileStack, exact: true },
      { href: "/owner/cms/grammar", label: "Grammar", icon: SpellCheck },
      { href: "/owner/cms?type=vocabulary", label: "Vocabulary", icon: Type },
      { href: "/owner/cms?type=speaking", label: "Speaking", icon: Mic },
      { href: "/owner/cms?type=writing", label: "Writing", icon: PenLine },
      { href: "/owner/cms?type=reading", label: "Reading", icon: BookOpen },
      { href: "/owner/cms?type=listening", label: "Listening", icon: Headphones },
      { href: "/owner/cms?type=ielts", label: "IELTS", icon: Trophy },
    ],
  },
  {
    label: "Assessment",
    items: [
      { href: "/owner/assessments", label: "Placement & tests", icon: Target },
      { href: "/owner/questions", label: "Question bank", icon: ClipboardList },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/owner/learners", label: "Learners", icon: Users },
      { href: "/owner/paywall", label: "Paywall", icon: CreditCard },
      { href: "/owner/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isNavActive(pathname: string, search: string, item: OwnerNavItem): boolean {
  const [path, query] = item.href.split("?");
  if (!path) return false;
  if (query) return pathname === path && search === query;
  if (item.exact) return pathname === path && !search;
  return pathname === path || pathname.startsWith(`${path}/`);
}
