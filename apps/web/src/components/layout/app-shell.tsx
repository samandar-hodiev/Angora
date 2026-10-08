"use client";

import { ChevronDown, CreditCard, LogOut, Menu, Shield, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";

import { Brand, BrandMark } from "@/components/common/brand";
import { OfflineBanner } from "@/components/common/offline-banner";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initials,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/overlay";
import {
  grammarNav,
  homeNav,
  isActivePath,
  learnNav,
  lexiconItems,
  lexiconNav,
  learnOverviewNav,
  mockExamNav,
  mobileNav,
  primaryNav,
  secondaryNav,
  skillHref,
  skillIcons,
  type NavItem,
} from "@/config/navigation";
import { useIsAdmin } from "@/features/admin/api";
import { useLogout, useSession } from "@/features/auth/hooks";
import { useSkills } from "@/features/learning/hooks";
import { useSyncAppearance } from "@/features/profile/appearance";
import { WallpaperLayer } from "@/features/profile/components/wallpaper-layer";
import { useSidebarWidth } from "@/components/layout/sidebar-resize";
import { NotificationsMenu } from "@/features/notifications/components/notifications-menu";
import { useProfile } from "@/features/profile/hooks";
import { useWallpaper } from "@/features/profile/wallpaper";
import { apiAssetUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

/**
 * Authenticated layout. Desktop: sidebar. Mobile: top bar + floating glass bottom
 * navigation (the same five destinations the native app will use).
 */
/** Sidebar sizes in px: icons only, the threshold below which it becomes that, default, widest. */
const SIDEBAR = { icons: 64, collapseAt: 136, initial: 216, max: 264 };

export function AppShell({ children }: { children: ReactNode }) {
  useSyncAppearance();
  const wallpaper = useWallpaper();
  const sidebar = useSidebarWidth("engora:app:sidebar-width", SIDEBAR);

  return (
    <div
      className="min-h-dvh md:grid md:grid-cols-[var(--learner-sidebar-w)_minmax(0,1fr)]"
      // Read by the wallpaper frame too, so the photo always starts where the sidebar ends.
      style={{ "--learner-sidebar-w": `${sidebar.width}px`, "--app-header-h": "3rem" } as CSSProperties}
    >
      {/* Not overflow-hidden: the resize edge sits a few pixels outside the border. The glow below
          clips itself, and the nav scrolls on its own. */}
      <aside className="glass-frosted sticky top-0 isolate hidden h-dvh min-w-0 flex-col border-y-0 border-l-0 md:flex">
        {/* Faint moving green light behind the frosted surface */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute -top-16 -left-12 size-56 animate-liquid-slow rounded-full bg-[radial-gradient(closest-side,var(--glass-tint),transparent)] opacity-70 blur-2xl motion-reduce:animate-none" />
        </span>
        <div className={cn("relative flex h-12 shrink-0 items-center px-4", sidebar.collapsed && "justify-center px-0")}>
          {sidebar.collapsed ? (
            <Link
              href="/app/dashboard"
              aria-label="Engora home"
              className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <BrandMark />
            </Link>
          ) : (
            <Brand href="/app/dashboard" className="min-w-0 text-body font-semibold" />
          )}
        </div>
        <SidebarNav collapsed={sidebar.collapsed} />
        {sidebar.handle}
      </aside>

      <div className="flex min-w-0 flex-col">
        <OfflineBanner />
        <header className="glass-frosted sticky top-0 z-30 flex h-12 items-center gap-2 overflow-hidden border-x-0 border-t-0 px-3 sm:px-6">
          <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="absolute -top-10 left-1/4 h-24 w-1/2 animate-liquid rounded-full bg-[radial-gradient(closest-side,var(--glass-tint),transparent)] opacity-60 blur-2xl motion-reduce:animate-none" />
          </span>
          <Sheet>
            <SheetTrigger asChild>
              <IconButton label="Open navigation" className="relative md:hidden">
                <Menu />
              </IconButton>
            </SheetTrigger>
            <SheetContent side="left" title="Navigation" className="glass-panel border-r-(--glass-border) bg-transparent p-0">
              <div className="px-5 pt-5">
                <Brand href="/app/dashboard" />
              </div>
              <SidebarNav inSheet />
            </SheetContent>
          </Sheet>
          <Brand href="/app/dashboard" className="relative md:hidden" />
          <div className="relative ml-auto flex items-center gap-1">
            <NotificationsMenu />
            <UserMenu />
          </div>
        </header>
        <main
          id="main"
          // Tells the theme a photo sits behind this area, and which way it reads, so text on it
          // can follow the picture instead of the theme (see theme.css). --app-header-h is the
          // header above: anything pinned inside the area measures from it.
          data-wallpaper-tone={wallpaper.tone ?? (wallpaper.selection === "custom" ? "dark" : undefined)}
          className="relative isolate flex-1 px-3 pt-(--main-pt) pb-32 [--main-pt:1rem] sm:px-5 md:pb-10 lg:px-6 lg:[--main-pt:1.25rem]"
        >
          {/* The learner's wallpaper covers this area only, never the header or sidebar. */}
          <WallpaperLayer />
          {/* The gap to the sidebar and the gap to the right edge are the same gap: the area's
              own padding, and nothing else. The cap is set high enough that it does not bind
              on an ordinary desk monitor, and when it finally does the area centres, so the
              two sides stay equal at every width instead of the remainder piling up on the
              right. Anything inside that wants a narrower measure — a reading passage, a
              lesson — sets its own. */}
          <div className="mx-auto w-full max-w-[160rem]">{children}</div>
        </main>
      </div>

      <nav aria-label="Primary" className="fixed inset-x-3 bottom-3 z-40 md:hidden">
        <ul className="glass grid grid-cols-5 rounded-2xl p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          {mobileNav.map((item) => (
            <MobileNavLink key={item.href} item={item} />
          ))}
        </ul>
      </nav>
    </div>
  );
}

function MobileNavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-medium transition-colors duration-micro",
          active ? "nav-liquid text-foreground" : "text-fg-muted",
        )}
      >
        <item.icon className="size-5" aria-hidden />
        {item.label}
      </Link>
    </li>
  );
}

function SidebarNav({ inSheet = false, collapsed = false }: { inSheet?: boolean; collapsed?: boolean }) {
  const pathname = usePathname();
  const skills = useSkills();
  const isAdmin = useIsAdmin();
  const learnSkills = (skills.data ?? []).slice(0, 4);
  const skillItems: NavItem[] = [
    learnOverviewNav,
    ...learnSkills.map((skill) => ({
      href: skillHref(skill.code),
      label: skill.name,
      icon: skillIcons[skill.code] ?? learnNav.icon,
    })),
  ];

  const link = (item: NavItem, nested = false) => {
    // The overview's href is the tree's own root, so it is active only on that page exactly,
    // not on every page underneath it.
    const active =
      nested && item.href === learnOverviewNav.href
        ? pathname === item.href
        : isActivePath(pathname, item.href);
    const node = (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          "relative flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-body-sm outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
          nested && "py-1 pl-7",
          collapsed && "justify-center px-0",
          // Hover is a wash of the shell's own colour: a white one disappears against the cards.
          active ? "nav-liquid font-medium text-foreground" : "text-(--nav-text) hover:bg-(--nav-hover) hover:text-foreground",
        )}
      >
        <item.icon
          className={cn(nested ? "size-3.5" : "size-4", "shrink-0", active ? "text-primary" : "text-fg-muted")}
          aria-hidden
        />
        {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      </Link>
    );
    return inSheet ? <SheetClose asChild>{node}</SheetClose> : node;
  };

  return (
    // Never scrolls sideways: a narrowed sidebar shortens its labels instead, and the lists are
    // minmax(0, 1fr) grids because a plain grid column will not shrink below its longest word.
    // The places scroll; Settings and Profile stay put underneath, so an open Practice or Lexicon
    // tree never pushes them out of reach — as in the owner console.
    <nav aria-label="Main" className={cn("relative flex min-h-0 flex-1 flex-col gap-3 px-2.5 pb-4", collapsed && "px-2")}>
      <ul className="scrollbar-slim -mx-1 grid min-h-0 flex-1 auto-rows-max grid-cols-[minmax(0,1fr)] gap-0.5 overflow-x-hidden overflow-y-auto px-1">
        <li>{link(homeNav)}</li>
        <li>{link(grammarNav)}</li>
        {/* What there is to learn first (grammar, then words), then where to practise it. */}
        <NavTree root={lexiconNav} id="nav-lexicon" items={lexiconItems} link={link} collapsed={collapsed} />
        <NavTree root={learnNav} id="nav-skills" items={skillItems} link={link} collapsed={collapsed} />
        <li>{link(mockExamNav)}</li>
        {primaryNav.map((item) => (
          <li key={item.href}>{link(item)}</li>
        ))}
      </ul>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-0.5 border-t pt-3">
        {isAdmin && link({ href: "/admin", label: "Admin console", icon: Shield })}
        {secondaryNav.map((item) => (
          <div key={item.href}>{link(item)}</div>
        ))}
      </div>
    </nav>
  );
}

/**
 * A row that folds a group of pages under it: Practice (Overview and the four practice skills),
 * Lexicon (vocabulary, phrases, collocations).
 *
 * Closed until it is wanted, so the sidebar reads as a short list of places; it opens by
 * itself when the page you are on is inside it, so a link straight to Writing never lands
 * on a sidebar that hides where you are. Icons only, it becomes a flyout instead — five
 * indented rows in a 64px column would be unreadable.
 */
function NavTree({
  root,
  id,
  items,
  link,
  collapsed,
}: {
  root: NavItem;
  id: string;
  items: NavItem[];
  link: (item: NavItem, nested?: boolean) => ReactNode;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const inside = items.some((item) => isActivePath(pathname, item.href));
  const [open, setOpen] = useState(inside);
  const [wasInside, setWasInside] = useState(inside);
  // Adjust during render rather than in an effect: navigating into the tree opens it in the
  // same paint, not a frame later.
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setOpen(true);
  }

  const row = cn(
    "relative flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-body-sm outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
    inside ? "font-medium text-foreground" : "text-(--nav-text) hover:bg-(--nav-hover) hover:text-foreground",
  );

  if (collapsed) {
    return (
      <li>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title={root.label} aria-label={root.label} className={cn(row, "justify-center px-0")}>
              <root.icon className={cn("size-4 shrink-0", inside ? "text-primary" : "text-fg-muted")} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            <DropdownMenuLabel>{root.label}</DropdownMenuLabel>
            {items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href}>
                  <item.icon aria-hidden />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  }

  const panelId = id;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className={row}
      >
        <root.icon className={cn("size-4 shrink-0", inside ? "text-primary" : "text-fg-muted")} aria-hidden />
        <span className="truncate">{root.label}</span>
        <ChevronDown
          className={cn("ml-auto size-3.5 shrink-0 transition-transform duration-micro", !open && "-rotate-90")}
          aria-hidden
        />
      </button>
      {open && (
        <ul id={panelId} className="mt-0.5 grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {items.map((item) => (
            <li key={item.href}>{link(item, true)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function UserMenu() {
  const { user } = useSession();
  const { data: profile } = useProfile();
  const isAdmin = useIsAdmin();
  const logout = useLogout();
  const router = useRouter();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.display_name || user?.email;
  const avatar = apiAssetUrl(profile?.avatar_url);

  const signOut = async () => {
    await logout.mutateAsync().catch(() => undefined);
    router.replace("/login");
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" aria-label="Account menu">
          <Avatar className="size-8">
            {avatar && <AvatarImage src={avatar} alt="" className="object-cover" />}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="grid gap-0.5 px-2.5 py-2">
          <p className="truncate text-label">{name}</p>
          <p className="truncate text-caption text-fg-muted">{user?.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/profile">
            <UserRound /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/subscription">
            <CreditCard /> Subscription
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield /> Admin console
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={logout.isPending} onSelect={() => setConfirmSignOut(true)}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    {/* Signing out ends the session on every tab, so it is always confirmed first. */}
    <Dialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign out of Engora?</DialogTitle>
          <DialogDescription>You&apos;ll need to sign in again to continue learning. Your progress is saved.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmSignOut(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={logout.isPending} onClick={() => void signOut()}>
            Sign out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
