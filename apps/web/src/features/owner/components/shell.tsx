"use client";

import {
  Bell,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  LogOut,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
  Tooltip,
  initials,
} from "@/components/ui/overlay";
import { useSession } from "@/features/auth/hooks";
import { AuroraCurtain } from "@/features/profile/components/wallpaper-layer";
import { cn } from "@/lib/utils";

import { ownerPreviewMode } from "../guard";
import { useAuditLogs } from "../hooks";
import { formatRelative } from "../lib/format";
import { OwnerPreferencesProvider, useOwnerConsole } from "../preferences";
import { isInsideTree, isNavActive, ownerNav, type OwnerNavItem } from "./nav";

/**
 * The Owner console shell.
 *
 * Deliberately not the learner shell: no wallpaper, no glass panels, no ambient motion. A
 * fixed sidebar, a thin header and a wide content column — the page's job is to hold tables
 * and numbers, and every pixel of decoration is a pixel not spent on them.
 */

const COLLAPSE_KEY = "engora:owner:sidebar-collapsed";

/**
 * The sidebar's collapsed state lives in localStorage, read through an external store so the
 * server render (always expanded) and the client agree, and so the value is read once rather
 * than on every render.
 */
let collapsedCache: boolean | null = null;
const collapseListeners = new Set<() => void>();

function readCollapsed(): boolean {
  if (collapsedCache === null) {
    try {
      collapsedCache = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      collapsedCache = false;
    }
  }
  return collapsedCache;
}

function writeCollapsed(next: boolean) {
  collapsedCache = next;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    /* private mode: the choice simply does not persist */
  }
  collapseListeners.forEach((listener) => listener());
}

function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  return () => {
    collapseListeners.delete(listener);
  };
}

const collapsedOnServer = () => false;

export function OwnerShell({ children }: { children: ReactNode }) {
  return (
    <OwnerPreferencesProvider>
      <OwnerShellBody>{children}</OwnerShellBody>
    </OwnerPreferencesProvider>
  );
}

function OwnerShellBody({ children }: { children: ReactNode }) {
  const { prefs, resolvedTheme, t, wallpaperImage, wallpaperAnimated } = useOwnerConsole();
  const remembered = useSyncExternalStore(subscribeCollapsed, readCollapsed, collapsedOnServer);
  // "Always expanded" and "always collapsed" win over whatever was left last time; that is
  // what the operator asked for by choosing them.
  const collapsed =
    prefs.sidebar_mode === "collapsed" ? true : prefs.sidebar_mode === "expanded" ? false : remembered;

  function toggleCollapsed() {
    writeCollapsed(!collapsed);
  }

  const accessibility = prefs.accessibility as Record<string, unknown>;
  const hasWallpaper = wallpaperImage !== null;

  return (
    <div
      // The theme class sits here, not on <html>: it is this operator's console theme, and
      // it must not touch the learner app's — theme.css binds the light palette to `.light`
      // for exactly this reason.
      className={cn(
        resolvedTheme,
        "relative isolate min-h-dvh bg-background md:grid",
        accessibility.larger_text === true && "text-[1.0625rem]",
        accessibility.reduced_motion === true && "[&_*]:!animate-none [&_*]:!transition-none",
        accessibility.high_contrast === true && "contrast-more",
        accessibility.density === "compact" && "[--owner-density:compact]",
        collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[15rem_minmax(0,1fr)]",
      )}
      lang={prefs.locale}
      data-owner-density={typeof accessibility.density === "string" ? accessibility.density : "comfortable"}
    >
      {/* The console background. Fixed and behind everything, dimmed by the amount the
          operator chose, and never over the content: a table you cannot read is not a
          nicer table. */}
      {hasWallpaper && (
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
          {/* A CSS background rather than an <img>: the built-in presets are gradients with
              no image to load, and an uploaded photo is decoration with nothing to describe. */}
          <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: wallpaperImage }} />
          {wallpaperAnimated && <AuroraCurtain />}
          {/* Dimmed by the amount the operator chose. A console is tables and numbers
              first, and a table you cannot read is not a nicer table. */}
          <span className="absolute inset-0 bg-background" style={{ opacity: prefs.wallpaper.overlay / 100 }} />
        </div>
      )}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh flex-col border-r md:flex",
          hasWallpaper ? "bg-surface/85 backdrop-blur-sm" : "bg-surface",
        )}
      >
        <div className={cn("flex h-14 items-center gap-2 border-b px-3", collapsed && "justify-center px-0")}>
          <Link href="/owner/dashboard" className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            {!collapsed && (
              <span className="grid min-w-0">
                <span className="truncate text-label leading-tight">Engora</span>
                <span className="truncate text-caption leading-tight text-fg-muted">{t.shell.console}</span>
              </span>
            )}
          </Link>
        </div>

        {/* The nav reads the query string to mark ?type=… destinations active, which makes it
            a client-only read: Suspense keeps the rest of the shell server-rendered. */}
        <Suspense fallback={<NavFallback collapsed={collapsed} />}>
          <OwnerNav collapsed={collapsed} />
        </Suspense>

        {/* Pinned below the scrolling navigation, so the console's own settings and the
            collapse control stay reachable however long the list above gets. "Back to the
            learner app" used to sit here; it is not a place in this console, so it moved to
            the account menu where the other cross-app actions live. */}
        <div className="mt-auto grid gap-1 border-t p-2">
          <OwnerSettingsLink collapsed={collapsed} />
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm text-fg-muted transition-colors duration-micro hover:bg-surface-hover hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
            {collapsed ? <span className="sr-only">Expand sidebar</span> : "Collapse sidebar"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-5">
          <Sheet>
            <SheetTrigger asChild>
              <IconButton label="Open owner navigation" className="md:hidden">
                <Menu />
              </IconButton>
            </SheetTrigger>
            <SheetContent side="left" title="Owner navigation" className="p-0">
              <div className="flex h-14 items-center gap-2 border-b px-4">
                <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
                  <ShieldCheck className="size-4" aria-hidden />
                </span>
                <span className="text-label">Owner console</span>
              </div>
              <div className="scrollbar-slim overflow-y-auto">
                <Suspense fallback={<NavFallback />}>
                  <OwnerNav inSheet />
                </Suspense>
              </div>
              <div className="mt-auto border-t p-2">
                <SheetClose asChild>
                  <OwnerSettingsLink />
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>

          <span className="font-medium md:hidden">Owner</span>

          {ownerPreviewMode && (
            <Tooltip content="The owner role is not enforced by the API yet, so this console is reachable in development. Everything it shows and changes is real platform data.">
              <Badge variant="warning" className="hidden sm:inline-flex">
                Dev access
              </Badge>
            </Tooltip>
          )}

          <div className="ml-auto flex items-center gap-1">
            <NotificationsMenu />
            <OwnerMenu />
          </div>
        </header>

        {/* The gap to the sidebar and the gap to the right edge are the same gap: the
            main padding, and nothing else. The cap is set high enough that it does not
            bind on any ordinary desk monitor, and it centres when it finally does, so the
            two sides stay equal at every width rather than dumping the remainder on the
            right. */}
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[160rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}

// The skeleton shown while the navigation resolves. It scrolls for the same reason the
// real navigation does: without it, a list taller than the sidebar is simply cut off, with
// no way to reach the end of it.
function NavFallback({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div aria-hidden className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-2">
      {ownerNav.flatMap((section) => section.items).map((item) => (
        <div key={item.href} className={cn("flex items-center gap-2.5 px-2.5 py-2", collapsed && "justify-center px-0")}>
          <item.icon className="size-4 shrink-0 text-fg-muted" />
          {!collapsed && <span className="h-3 w-24 rounded bg-surface-active" />}
        </div>
      ))}
    </div>
  );
}

function OwnerNav({ collapsed = false, inSheet = false }: { collapsed?: boolean; inSheet?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  return (
    <nav aria-label="Owner" className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-2">
      {ownerNav.map((section) => (
        <div key={section.label} className="mb-3 last:mb-0">
          {!collapsed && (
            <h2 className="px-2.5 pt-2 pb-1 text-caption font-medium tracking-wide text-fg-muted uppercase">
              {section.label}
            </h2>
          )}
          {collapsed && <div className="mx-2 my-2 h-px bg-border-subtle" aria-hidden />}
          <ul className="grid gap-0.5">
            {section.items.map((item) =>
              item.children ? (
                <NavTree
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  collapsed={collapsed}
                  inSheet={inSheet}
                />
              ) : (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={isNavActive(pathname, search, item)}
                    collapsed={collapsed}
                    inSheet={inSheet}
                  />
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function navLinkClass(active: boolean, collapsed: boolean, depth: 0 | 1) {
  return cn(
    "flex items-center gap-2.5 rounded-md text-body-sm transition-colors duration-micro",
    // Children are a step quieter than their parent: smaller row, indented, so the tree
    // reads as one thing rather than eleven more top-level destinations.
    depth === 0 ? "px-2.5 py-2" : "py-1.5 pr-2.5 pl-8",
    collapsed && "justify-center px-0",
    active
      ? "bg-primary-subtle font-medium text-primary-subtle-foreground"
      : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
  );
}

function NavLink({
  item,
  active,
  collapsed = false,
  inSheet = false,
  depth = 0,
  /**
   * False for a parent that is merely containing the current page. It is highlighted, but
   * it is not the page you are on, and only one thing can be — announcing two would make
   * the sidebar lie to a screen reader.
   */
  current = active,
}: {
  item: OwnerNavItem;
  active: boolean;
  collapsed?: boolean;
  inSheet?: boolean;
  depth?: 0 | 1;
  current?: boolean;
}) {
  const link = (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={navLinkClass(active, collapsed, depth)}
    >
      <item.icon
        className={cn(depth === 0 ? "size-4" : "size-3.5", "shrink-0", active ? "text-primary" : "text-fg-muted")}
        aria-hidden
      />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
    </Link>
  );
  return inSheet ? <SheetClose asChild>{link}</SheetClose> : link;
}

/**
 * A navigation item with pages inside it.
 *
 * The parent is a link and the chevron is a separate button, because those are two
 * different intentions: "take me to Content CMS" and "show me what is in it". Arriving
 * anywhere inside the tree opens it, so a bookmark straight to Grammar does not land on a
 * sidebar that hides where you are.
 *
 * Collapsed, the tree becomes a flyout instead: eleven indented rows in a 4rem column would
 * be unreadable, and hiding them entirely would make the collapsed sidebar a dead end.
 */
function NavTree({
  item,
  pathname,
  collapsed,
  inSheet,
}: {
  item: OwnerNavItem;
  pathname: string;
  collapsed: boolean;
  inSheet: boolean;
}) {
  const inside = isInsideTree(pathname, item) || isNavActive(pathname, "", item);
  const [expanded, setExpanded] = useState(inside);
  const [wasInside, setWasInside] = useState(inside);

  // Adjust during render rather than in an effect: navigating into the tree must open it
  // in the same paint, not a frame later.
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setExpanded(true);
  }

  const children = item.children ?? [];
  const panelId = `nav-tree-${item.href.replace(/\W+/g, "-")}`;

  if (collapsed) {
    return (
      <li>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={item.label}
              aria-label={item.label}
              className={cn(navLinkClass(inside, true, 0), "w-full")}
            >
              <item.icon className={cn("size-4 shrink-0", inside ? "text-primary" : "text-fg-muted")} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-56">
            <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
            {children.map((child) => (
              <DropdownMenuItem key={child.href} asChild>
                <Link href={child.href} aria-current={isNavActive(pathname, "", child) ? "page" : undefined}>
                  <child.icon aria-hidden />
                  {child.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  }

  return (
    <li>
      {/* The whole row is the disclosure, not just the chevron. A parent that opens on the
          first click and then ignores the second one is the most annoying kind of broken:
          it looks like nothing happened. Overview is the child that opens the page, so the
          parent does not have to be a link as well as a toggle. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(navLinkClass(inside, false, 0), "w-full text-left")}
      >
        <item.icon className={cn("size-4 shrink-0", inside ? "text-primary" : "text-fg-muted")} aria-hidden />
        <span className="truncate">{item.label}</span>
        <ChevronDown
          className={cn("ml-auto size-3.5 shrink-0 transition-transform duration-micro", !expanded && "-rotate-90")}
          aria-hidden
        />
      </button>
      {expanded && (
        <ul id={panelId} className="mt-0.5 grid gap-0.5">
          {children.map((child) => (
            <li key={child.href}>
              <NavLink
                item={child}
                active={isNavActive(pathname, "", child)}
                inSheet={inSheet}
                depth={1}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function NotificationsMenu() {
  // The audit log is the platform's own record of what changed; a separate notification
  // feed would be a second version of the same truth.
  const { data } = useAuditLogs({ days: 7, page: 1 });
  const entries = data?.items.slice(0, 6) ?? [];
  const count = entries.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Notifications${count ? `, ${count} recent` : ""}`} className="relative">
          <Bell />
          {count > 0 && (
            <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Recent activity</DropdownMenuLabel>
        {count === 0 && <p className="px-2.5 py-6 text-center text-body-sm text-fg-muted">Nothing new right now.</p>}
        {entries.map((entry) => (
          <DropdownMenuItem key={entry.id} className="grid gap-0.5 whitespace-normal">
            <span className="text-body-sm">{entry.action.replace(/[._]/g, " ")}</span>
            <span className="text-caption text-fg-muted">
              {entry.actor_email ?? "System"} · {formatRelative(entry.created_at, new Date().toISOString())}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/owner/audit">View the audit log</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OwnerMenu() {
  const user = useSession().user;
  const email = user?.email ?? "owner@engora.com";
  const name = email.split("@")[0] ?? "Platform owner";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Owner menu"
          className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Avatar className="size-8">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="text-body-sm text-foreground">{name}</span>
          <span className="text-caption text-fg-muted">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/owner/settings">
            <SlidersHorizontal aria-hidden />
            Owner Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/profile">
            <UserRound aria-hidden />
            Owner profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          {/* Leaving the console is an action, not a destination inside it. */}
          <Link href="/app/dashboard">
            <ExternalLink aria-hidden />
            Open Learner App
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/login">
            <LogOut aria-hidden />
            Sign out
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OwnerQuickActions({ actions }: { actions: { label: string; href: string; icon: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button key={action.href} variant="outline" size="sm" asChild>
          <Link href={action.href}>
            {action.icon}
            {action.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}

/**
 * The console's own settings, pinned to the bottom of the sidebar.
 *
 * Bottom-left rather than in the Platform list because it is about the tool, not about the
 * product: everything in Platform changes something a learner will meet, and this changes
 * nothing but the screen the operator is looking at.
 */
function OwnerSettingsLink({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  // Exact, so standing in the Learner App's settings never lights this up and vice versa.
  const active = pathname === "/owner/settings" || pathname.startsWith("/owner/settings/");

  return (
    <Link
      href="/owner/settings"
      aria-current={active ? "page" : undefined}
      title={collapsed ? "Owner Settings" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm transition-colors duration-micro",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary-subtle font-medium text-primary-subtle-foreground"
          : "text-fg-muted hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <SlidersHorizontal className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
      {collapsed ? <span className="sr-only">Owner Settings</span> : "Owner Settings"}
    </Link>
  );
}
