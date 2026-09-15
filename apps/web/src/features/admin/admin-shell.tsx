"use client";

import {
  ArrowLeft,
  BarChart3,
  CircleDollarSign,
  CreditCard,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Server,
  ShieldAlert,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Brand } from "@/components/common/brand";
import { EmptyState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

import { useIsAdmin } from "./api";

const adminNav = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/revenue", label: "Revenue", icon: Wallet },
  { href: "/admin/content", label: "Content", icon: FileText },
  { href: "/admin/ai-usage", label: "AI Usage", icon: Sparkles },
  { href: "/admin/ai-costs", label: "AI Costs", icon: CircleDollarSign },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/system", label: "System", icon: Server },
];

function Nav({ inSheet = false }: { inSheet?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className="grid gap-0.5">
      {adminNav.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        const link = (
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body-sm transition-colors duration-micro",
              active ? "bg-surface-active font-medium text-foreground" : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-4", active ? "text-primary" : "text-fg-muted")} aria-hidden />
            {item.label}
          </Link>
        );
        return <li key={item.href}>{inSheet ? <SheetClose asChild>{link}</SheetClose> : link}</li>;
      })}
    </ul>
  );
}

/** Owner/admin console: same design system, denser layout. The API enforces permissions. */
export function AdminShell({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <main id="main" className="mx-auto max-w-lg px-4 py-24">
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          description="Your account doesn't have access to the admin console."
          action={
            <Button asChild>
              <Link href="/app/dashboard">Back to the app</Link>
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[13.5rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-5 border-r bg-surface/60 px-3 py-4 md:flex">
        <div className="flex items-center gap-2 px-2">
          <Brand href="/admin" />
          <Badge variant="outline">Admin</Badge>
        </div>
        <Nav />
        <Link href="/app/dashboard" className="mt-auto flex items-center gap-2 px-2.5 text-body-sm text-fg-muted hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Back to app
        </Link>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <IconButton label="Open admin navigation">
                <Menu />
              </IconButton>
            </SheetTrigger>
            <SheetContent side="left" title="Admin navigation">
              <Brand href="/admin" />
              <Nav inSheet />
            </SheetContent>
          </Sheet>
          <Brand href="/admin" />
        </header>
        <main id="main" className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
