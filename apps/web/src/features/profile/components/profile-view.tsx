"use client";

import { Clock, Flame, Target } from "lucide-react";
import Link from "next/link";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Avatar, AvatarFallback, AvatarImage, initials } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/hooks";
import { useProgress } from "@/features/learner/hooks";
import { goalLabel } from "@/features/onboarding/labels";
import { useCurrentSubscription } from "@/features/subscription/hooks";
import { apiAssetUrl } from "@/lib/media";

import { useProfile } from "../hooks";
import { ProfileCard } from "./profile-form";

const coreSkills = ["speaking", "writing", "reading", "listening"];

export function ProfileView() {
  const { user } = useSession();
  const profile = useProfile();
  const progress = useProgress();
  const subscription = useCurrentSubscription();

  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const p = profile.data;
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.display_name || "";
  const avatar = apiAssetUrl(p?.avatar_url);

  return (
    <>
      <PageHeader title="Profile" />
      <section className="grid gap-6 rounded-xl border bg-surface p-6 sm:grid-cols-[auto_1fr] sm:items-center">
        <Avatar className="size-20">
          {avatar && <AvatarImage src={avatar} alt="" className="object-cover" />}
          <AvatarFallback className="text-h2">{initials(name || user?.email)}</AvatarFallback>
        </Avatar>
        <div className="grid gap-3">
          <div>
            {profile.isPending ? <Skeleton className="h-8 w-48" /> : <h2 className="text-h2">{name || "Learner"}</h2>}
            <p className="text-body-sm text-fg-muted">{user?.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {p?.current_level ?? "Level not set"}
              {p?.target_level ? ` → ${p.target_level}` : ""}
            </Badge>
            {p?.learning_goals.map((g) => (
              <Badge key={g} variant="outline">
                <Target aria-hidden /> {goalLabel(g)}
              </Badge>
            ))}
            {p && (
              <Badge variant="outline">
                <Clock aria-hidden /> {p.daily_goal_minutes} min / day
              </Badge>
            )}
            {progress.data && (
              <Badge variant="warning">
                <Flame aria-hidden /> {progress.data.streak.current_days} day streak
              </Badge>
            )}
            {subscription.data && (
              <Badge asChild variant="default">
                <Link href="/app/subscription">{subscription.data.entitlements.plan_name}</Link>
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* Side by side only on screens wider than a MacBook; stacked on laptops and below. */}
      <div className="mt-10 grid gap-10 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section aria-labelledby="overview-title">
          <SectionTitle
            id="overview-title"
            title="Skill overview"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/app/progress">Progress</Link>
              </Button>
            }
          />
          <div className="grid gap-4 rounded-xl border bg-surface p-5">
            {progress.isPending
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)
              : progress.data?.skills
                  .filter((s) => coreSkills.includes(s.code))
                  .map((s) => <Meter key={s.code} label={s.name} value={s.score} display={s.sessions ? String(Math.round(s.score)) : "—"} />)}
          </div>
        </section>
        <section aria-labelledby="learning-profile-title">
          <SectionTitle id="learning-profile-title" title="Learning profile" />
          <ProfileCard />
        </section>
      </div>
    </>
  );
}
