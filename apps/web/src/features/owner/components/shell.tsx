"use client";

import {
  ArrowLeft,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Menu,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore, type ReactNode } from "react";

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
import { cn } from "@/lib/utils";

import { ownerPreviewMode } from "../guard";
import { useActivityFeed } from "../hooks";
import { formatRelative } from "../lib/format";
import { MOCK_TODAY } from "../lib/mock";
import { isNavActive, ownerNav } from "./nav";

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
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, collapsedOnServer);

  function toggleCollapsed() {
    writeCollapsed(!collapsed);
  }

  return (
    <div
      className={cn(
        "min-h-dvh bg-background md:grid",
        collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[15rem_minmax(0,1fr)]",
      )}
    >
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-surface md:flex">
        <div className={cn("flex h-14 items-center gap-2 border-b px-3", collapsed && "justify-center px-0")}>
          <Link href="/owner/dashboard" className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            {!collapsed && (
              <span className="grid min-w-0">
                <span className="truncate text-label leading-tight">Engora</span>
                <span className="truncate text-caption leading-tight text-fg-muted">Owner console</span>
              </span>
            )}
          </Link>
        </div>

        {/* The nav reads the query string to mark ?type=… destinations active, which makes it
            a client-only read: Suspense keeps the rest of the shell server-rendered. */}
        <Suspense fallback={<NavFallback collapsed={collapsed} />}>
          <OwnerNav collapsed={collapsed} />
        </Suspense>

        <div className="mt-auto grid gap-1 border-t p-2">
          <Link
            href="/app/dashboard"
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm text-fg-muted transition-colors duration-micro hover:bg-surface-hover hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            {!collapsed && "Back to learner app"}
          </Link>
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
              <div className="overflow-y-auto">
                <Suspense fallback={<NavFallback />}>
                  <OwnerNav inSheet />
                </Suspense>
              </div>
              <div className="mt-auto border-t p-2">
                <SheetClose asChild>
                  <Link
                    href="/app/dashboard"
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm text-fg-muted hover:bg-surface-hover hover:text-foreground"
                  >
                    <ArrowLeft className="size-4" aria-hidden />
                    Back to learner app
                  </Link>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>

          <span className="font-medium md:hidden">Owner</span>

          {ownerPreviewMode && (
            <Tooltip content="The /api/v1/owner endpoints do not exist yet. Everything here runs on the mock service layer and nothing is saved.">
              <Badge variant="warning" className="hidden sm:inline-flex">
                Preview data
              </Badge>
            </Tooltip>
          )}

          <div className="ml-auto flex items-center gap-1">
            <NotificationsMenu />
            <OwnerMenu />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[86rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavFallback({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div aria-hidden className="flex-1 p-2">
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
    <nav aria-label="Owner" className="flex-1 overflow-y-auto p-2">
      {ownerNav.map((section) => (
        <div key={section.label} className="mb-3 last:mb-0">
          {!collapsed && (
            <h2 className="px-2.5 pt-2 pb-1 text-caption font-medium tracking-wide text-fg-muted uppercase">
              {section.label}
            </h2>
          )}
          {collapsed && <div className="mx-2 my-2 h-px bg-border-subtle" aria-hidden />}
          <ul className="grid gap-0.5">
            {section.items.map((item) => {
              const active = isNavActive(pathname, search, item);
              const link = (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm transition-colors duration-micro",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-primary-subtle font-medium text-primary-subtle-foreground"
                      : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <item.icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-fg-muted")} aria-hidden />
                  {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                </Link>
              );
              return <li key={item.href}>{inSheet ? <SheetClose asChild>{link}</SheetClose> : link}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NotificationsMenu() {
  const { data } = useActivityFeed(5);
  const count = data?.length ?? 0;

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
        {data?.map((event) => (
          <DropdownMenuItem key={event.id} className="grid gap-0.5 whitespace-normal">
            <span className="text-body-sm">{event.message}</span>
            <span className="text-caption text-fg-muted">{formatRelative(event.created_at, `${MOCK_TODAY}T12:00:00Z`)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/owner/analytics">View all activity</Link>
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
            <UserRound aria-hidden />
            Site settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/profile">
            <ArrowLeft aria-hidden />
            Learner profile
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
