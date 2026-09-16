"use client";

import { Bell, CreditCard, LogOut, Menu, Shield, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Brand } from "@/components/common/brand";
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
import { homeNav, isActivePath, learnNav, mobileNav, primaryNav, secondaryNav, skillHref, type NavItem } from "@/config/navigation";
import { useIsAdmin } from "@/features/admin/api";
import { useLogout, useSession } from "@/features/auth/hooks";
import { useSkills } from "@/features/learning/hooks";
import { useSyncAppearance } from "@/features/profile/appearance";
import { WallpaperLayer } from "@/features/profile/components/wallpaper-layer";
import { useProfile } from "@/features/profile/hooks";
import { useWallpaper } from "@/features/profile/wallpaper";
import { apiAssetUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

/**
 * Authenticated layout. Desktop: sidebar. Mobile: top bar + floating glass bottom
 * navigation (the same five destinations the native app will use).
 */
export function AppShell({ children }: { children: ReactNode }) {
  useSyncAppearance();
  const wallpaper = useWallpaper();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="glass-frosted sticky top-0 isolate hidden h-dvh flex-col overflow-hidden border-y-0 border-l-0 md:flex">
        {/* Faint moving green light behind the frosted surface */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute -top-16 -left-12 size-56 animate-liquid-slow rounded-full bg-[radial-gradient(closest-side,var(--glass-tint),transparent)] opacity-70 blur-2xl motion-reduce:animate-none" />
        </span>
        <div className="relative px-5 pt-5 pb-4">
          <Brand href="/app/dashboard" />
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-col">
        <OfflineBanner />
        <header className="glass-frosted sticky top-0 z-30 flex h-14 items-center gap-2 overflow-hidden border-x-0 border-t-0 px-3 sm:px-6">
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
          // Tells the theme that faint text here has a photo behind it (see theme.css).
          data-wallpaper={wallpaper.selection === "custom" ? "photo" : undefined}
          className="relative isolate flex-1 px-4 pt-6 pb-32 sm:px-6 md:pb-12 lg:px-10 lg:pt-8"
        >
          {/* The learner's wallpaper covers this area only, never the header or sidebar. */}
          <WallpaperLayer />
          <div className="mx-auto w-full max-w-6xl">{children}</div>
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

function SidebarNav({ inSheet = false }: { inSheet?: boolean }) {
  const pathname = usePathname();
  const skills = useSkills();
  const isAdmin = useIsAdmin();
  const learnSkills = (skills.data ?? []).slice(0, 4);

  const link = (item: NavItem, nested = false) => {
    const active = nested ? pathname === item.href || pathname.startsWith(`${item.href}/`) : isActivePath(pathname, item.href);
    const node = (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-body-sm outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
          nested && "py-1.5 pl-10",
          active ? "nav-liquid font-medium text-foreground" : "text-fg-secondary hover:bg-surface-active hover:text-foreground",
        )}
      >
        {!nested && <item.icon className={cn("size-4", active ? "text-primary" : "text-fg-muted")} aria-hidden />}
        {item.label}
      </Link>
    );
    return inSheet ? <SheetClose asChild>{node}</SheetClose> : node;
  };

  return (
    <nav aria-label="Main" className="relative flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-5">
      <ul className="grid gap-0.5">
        <li>{link(homeNav)}</li>
        <li>
          {link(learnNav)}
          <ul className="mt-0.5 grid gap-0.5">
            {learnSkills.map((skill) => (
              <li key={skill.id}>{link({ href: skillHref(skill.code), label: skill.name, icon: learnNav.icon }, true)}</li>
            ))}
          </ul>
        </li>
        {primaryNav.map((item) => (
          <li key={item.href}>{link(item)}</li>
        ))}
      </ul>
      <div className="mt-auto grid gap-0.5 border-t pt-4">
        {isAdmin && link({ href: "/admin", label: "Admin console", icon: Shield })}
        {secondaryNav.map((item) => (
          <div key={item.href}>{link(item)}</div>
        ))}
      </div>
    </nav>
  );
}

function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Notifications">
          <Bell />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <div className="grid justify-items-center gap-1 px-4 py-6 text-center">
          <Bell className="size-5 text-fg-muted" aria-hidden />
          <p className="text-label">You&apos;re all caught up</p>
          <p className="text-caption text-fg-muted">Feedback results and reminders will appear here.</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
