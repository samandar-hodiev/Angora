"use client";

import { LayoutDashboard, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
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
} from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogout, useSession } from "@/features/auth/hooks";
import { useProfile } from "@/features/profile/hooks";
import { apiAssetUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

import { useI18n } from "../i18n";

/** Name, email and avatar of the signed-in learner (from the API profile). */
function useAccount() {
  const session = useSession();
  const profile = useProfile();
  const p = profile.data;
  const email = session.user?.email ?? "";
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.display_name || email;
  return { session, name, email, avatar: apiAssetUrl(p?.avatar_url), loadingProfile: profile.isPending };
}

function AccountAvatar({ name, avatar, className }: { name: string; avatar: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-8 border border-(--glass-border)", className)}>
      {avatar && <AvatarImage src={avatar} alt="" className="object-cover" />}
      <AvatarFallback className="bg-primary-subtle text-caption font-semibold text-primary-subtle-foreground">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Desktop header actions: account menu for signed-in learners, sign-in/sign-up otherwise.
 * While the session is being restored a neutral placeholder avoids flashing the buttons.
 */
export function HeaderAccount({ guest }: { guest: ReactNode }) {
  const { t } = useI18n();
  const { session, name, email, avatar, loadingProfile } = useAccount();
  const logout = useLogout();

  if (session.status === "loading") return <Skeleton className="h-9 w-36 rounded-lg" aria-hidden />;
  if (session.status !== "authenticated") return guest;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t.nav.account}
          className="flex h-9 max-w-56 items-center gap-2 rounded-lg px-1.5 text-body-sm font-medium text-fg-secondary outline-none transition-colors duration-micro hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {loadingProfile ? <Skeleton className="h-4 w-20" /> : <span className="truncate">{name}</span>}
          <AccountAvatar name={name} avatar={avatar} className="size-6 text-[0.625rem]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <AccountAvatar name={name} avatar={avatar} className="size-10" />
          <span className="grid min-w-0">
            <span className="truncate text-body-sm font-medium text-foreground">{name}</span>
            <span className="truncate text-caption font-normal text-fg-muted">{email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/dashboard">
            <LayoutDashboard aria-hidden /> {t.nav.dashboard}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/profile">
            <UserRound aria-hidden /> {t.nav.profile}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings aria-hidden /> {t.nav.settings}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden /> {t.nav.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobile menu footer: the same account, or the sign-in/sign-up buttons. */
export function MenuAccount({ guest, onNavigate }: { guest: ReactNode; onNavigate: () => void }) {
  const { t } = useI18n();
  const { session, name, email, avatar } = useAccount();
  const logout = useLogout();

  if (session.status === "loading") return <Skeleton className="h-24 rounded-xl" aria-hidden />;
  if (session.status !== "authenticated") return guest;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 rounded-xl border border-(--glass-border) bg-surface/40 p-3">
        <AccountAvatar name={name} avatar={avatar} className="size-11" />
        <span className="grid min-w-0">
          <span className="truncate text-body font-medium">{name}</span>
          <span className="truncate text-caption text-fg-muted">{email}</span>
        </span>
      </div>
      <Button asChild size="lg" variant="liquid">
        <Link href="/app/dashboard" onClick={onNavigate}>
          <LayoutDashboard aria-hidden /> {t.nav.dashboard}
        </Link>
      </Button>
      <Button size="lg" variant="glass" onClick={() => logout.mutate()} loading={logout.isPending}>
        <LogOut aria-hidden /> {t.nav.signOut}
      </Button>
    </div>
  );
}
