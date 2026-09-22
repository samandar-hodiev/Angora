import {
  Bell,
  Files,
  BookOpen,
  ClipboardList,
  CreditCard,
  FileStack,
  Headphones,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  Mic,
  PenLine,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SpellCheck,
  Target,
  Trophy,
  Type,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface OwnerNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Matched with startsWith; exact routes opt out. */
  exact?: boolean;
  /**
   * Pages that live inside this one. They are rendered as a tree in the sidebar, indented
   * under their parent, and the parent stays highlighted while any of them is open — so
   * the console always shows where you are, not only what you clicked last.
   */
  children?: OwnerNavItem[];
  /** Shown only to the platform owner. Hiding it is courtesy; the API is the control. */
  ownerOnly?: boolean;
}

export interface OwnerNavSection {
  label: string;
  items: OwnerNavItem[];
}

/**
 * The console's navigation.
 *
 * Three areas, and they are never mixed:
 *
 *   Content CMS   what the owner writes for learners to study.
 *   Platform      who the learners are, what they pay, what the platform did — plus the
 *                 Learner App's own configuration, which is a thing the owner sets *for*
 *                 learners, not a setting of this console.
 *   Owner Settings  this console: its language, its theme, its background, this
 *                 operator's sessions. Pinned to the bottom because it is about the tool,
 *                 not about the product.
 *
 * The individual content types used to sit in this list — eight rows that were really one
 * page with a filter. They now live inside Content CMS, where they belong and where they
 * stop pushing Platform off the bottom of a 13" screen.
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
      {
        href: "/owner/content",
        label: "Content CMS",
        icon: FileStack,
        children: [
          { href: "/owner/content", label: "Overview", icon: LayoutGrid, exact: true },
          { href: "/owner/content/all", label: "All content", icon: Files },
          { href: "/owner/content/grammar", label: "Grammar", icon: SpellCheck },
          { href: "/owner/content/vocabulary", label: "Vocabulary", icon: Type },
          { href: "/owner/content/speaking", label: "Speaking", icon: Mic },
          { href: "/owner/content/writing", label: "Writing", icon: PenLine },
          { href: "/owner/content/reading", label: "Reading", icon: BookOpen },
          { href: "/owner/content/listening", label: "Listening", icon: Headphones },
          { href: "/owner/content/ielts", label: "IELTS", icon: Trophy },
          { href: "/owner/content/placement", label: "Placement & tests", icon: Target },
          { href: "/owner/content/question-bank", label: "Question bank", icon: ClipboardList },
        ],
      },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/owner/learners", label: "Learners", icon: Users },
      { href: "/owner/paywall", label: "Paywall", icon: CreditCard },
      { href: "/owner/payments", label: "Payments", icon: Wallet },
      { href: "/owner/notifications", label: "Notifications", icon: Bell },
      { href: "/owner/ai", label: "AI", icon: Sparkles },
      { href: "/owner/audit", label: "Audit log", icon: ScrollText },
      // Named for what it configures. It is the Learner App's settings, not this console's.
      { href: "/owner/learner-app", label: "Learner App", icon: Smartphone },
      // Owner only. The page itself refuses anybody else; this hides a door they cannot open.
      { href: "/owner/staff", label: "Staff", icon: ShieldCheck, ownerOnly: true },
    ],
  },
];

/** The content types that have a page of their own under Content CMS. */
export const contentTypes = ["reading", "listening", "speaking", "writing", "vocabulary", "ielts"] as const;
export type ContentTypeSlug = (typeof contentTypes)[number];

export function isContentType(value: string): value is ContentTypeSlug {
  return (contentTypes as readonly string[]).includes(value);
}

export function isNavActive(pathname: string, search: string, item: OwnerNavItem): boolean {
  const [path, query] = item.href.split("?");
  if (!path) return false;
  if (query) return pathname === path && search === query;
  if (item.exact) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Whether the current route is anywhere inside this item's tree. */
export function isInsideTree(pathname: string, item: OwnerNavItem): boolean {
  if (!item.children) return false;
  return item.children.some((child) => isNavActive(pathname, "", child));
}

/** Every item the sidebar can show, nested ones included — used by the loading skeleton. */
export function flatNavItems(): OwnerNavItem[] {
  return ownerNav.flatMap((section) => section.items);
}
