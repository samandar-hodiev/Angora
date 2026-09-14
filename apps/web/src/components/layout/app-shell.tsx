"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Brand } from "@/components/common/brand";
import { Button } from "@/components/ui/button";
import { accountNav, isActivePath, mobileNav, primaryNav, type NavItem } from "@/config/navigation";
import { useLogout, useSession } from "@/features/auth/hooks";
import { cn } from "@/lib/utils";

/**
 * Authenticated layout. Mobile-first: bottom navigation below md, sidebar from md up.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-card/60 px-3 py-5 md:flex">
        <Brand href="/app/dashboard" className="px-3" />
        <nav aria-label="Main" className="flex flex-1 flex-col justify-between gap-6 overflow-y-auto">
          <SidebarList items={primaryNav} pathname={pathname} />
          <SidebarList items={accountNav} pathname={pathname} />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background/85 px-4 backdrop-blur sm:px-6 md:justify-end">
          <Brand href="/app/dashboard" className="md:hidden" />
          <UserMenu />
        </header>
        <main id="main" className="flex-1 px-4 pt-6 pb-28 sm:px-6 md:pb-10 lg:px-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {mobileNav.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="size-5" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function SidebarList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="grid gap-1">
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserMenu() {
  const { user } = useSession();
  const logout = useLogout();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      <span className="hidden max-w-56 truncate text-sm text-muted-foreground sm:inline">{user?.email}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={logout.isPending}
        onClick={async () => {
          await logout.mutateAsync().catch(() => undefined);
          router.replace("/login");
        }}
      >
        <LogOut aria-hidden />
        Sign out
      </Button>
    </div>
  );
}
