"use client";

import { ArrowRight, Clock, GraduationCap } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SkillGrid } from "@/features/learning/components/skill-grid";
import { useProfile } from "@/features/profile/hooks";
import { UsageSummary } from "@/features/subscription/components/subscription-views";

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The dashboard composes feature modules; it owns no data of its own. Everything shown
 * comes from the API so the future mobile app renders the same state.
 */
export function DashboardView() {
  const { data: profile, isPending } = useProfile();

  return (
    <div className="grid gap-8">
      <section className="grid gap-2">
        {isPending ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}
            {profile?.display_name ? `, ${profile.display_name}` : ""}
          </h1>
        )}
        <p className="text-sm text-muted-foreground">What will you practise today?</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <GraduationCap className="size-4" aria-hidden /> Current level
            </CardDescription>
            <CardTitle className="text-2xl">
              {isPending ? <Skeleton className="h-7 w-16" /> : (profile?.current_level ?? "—")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile && !profile.current_level && (
              <Button variant="link" className="h-auto p-0" asChild>
                <Link href="/app/profile">
                  Set your level <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
            {profile?.target_level && <Badge variant="secondary">Target {profile.target_level}</Badge>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden /> Daily goal
            </CardDescription>
            <CardTitle className="text-2xl">
              {isPending ? <Skeleton className="h-7 w-24" /> : `${profile?.daily_goal_minutes ?? 15} min`}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Time tracking arrives with practice sessions.
          </CardContent>
        </Card>

        <div className="md:row-span-1">
          <UsageSummary />
        </div>
      </section>

      <section aria-labelledby="skills-title" className="grid gap-4">
        <div className="flex items-end justify-between">
          <h2 id="skills-title" className="text-lg font-semibold tracking-tight">
            Skills
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/app/learn">
              View all <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
        <SkillGrid />
      </section>
    </div>
  );
}
