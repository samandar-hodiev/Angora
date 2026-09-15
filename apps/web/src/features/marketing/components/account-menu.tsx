"use client";

import { LayoutDashboard, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage, initials } from "@/components/ui/overlay";
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
 * Desktop header action for signed-in learners: name + avatar linking straight into the app
 * (today's plan on the dashboard — the journey guard sends unfinished learners to their
 * current setup step). Signed-out visitors get the sign-in/sign-up buttons. While the session
 * is being restored a neutral placeholder avoids flashing the buttons.
 */
export function HeaderAccount({ guest }: { guest: ReactNode }) {
  const { t } = useI18n();
  const { session, name, avatar, loadingProfile } = useAccount();

  if (session.status === "loading") return <Skeleton className="h-9 w-36 rounded-lg" aria-hidden />;
  if (session.status !== "authenticated") return guest;

  return (
    <Link
      href="/app/dashboard"
      aria-label={`${t.nav.dashboard}: ${name}`}
      className="group flex h-9 max-w-60 items-center gap-2.5 px-1 text-body-sm font-medium text-fg-secondary outline-none transition-colors duration-micro hover:text-foreground focus-visible:text-foreground"
    >
      {loadingProfile ? (
        <Skeleton className="h-4 w-20" />
      ) : (
        <span className="truncate underline-offset-4 group-focus-visible:underline">{name}</span>
      )}
      <AccountAvatar name={name} avatar={avatar} className="size-8 border-0" />
    </Link>
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
