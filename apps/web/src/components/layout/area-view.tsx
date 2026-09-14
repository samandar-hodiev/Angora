"use client";

import { Compass, Sparkles } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { plannedAreas } from "@/config/navigation";
import { SkillIcon } from "@/features/learning/components/skill-grid";
import { useSkills } from "@/features/learning/hooks";
import { useFeature } from "@/features/subscription/hooks";

export function AreaView({ slug }: { slug: string }) {
  const skills = useSkills();
  const planned = plannedAreas[slug];

  if (planned) {
    return (
      <>
        <PageHeader title={planned.title} description={planned.description} />
        <ComingSoon phase={planned.phase} entitlement={planned.entitlement} />
      </>
    );
  }

  if (skills.isPending) return <Skeleton className="h-40 rounded-xl" />;
  if (skills.isError) return <ErrorState error={skills.error} onRetry={() => void skills.refetch()} />;

  const skill = skills.data.find((s) => s.code === slug);
  if (!skill) {
    return (
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="This part of Engora doesn't exist."
        action={
          <Button variant="outline" asChild>
            <Link href="/app/dashboard">Back to home</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground">
          <SkillIcon code={skill.code} className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{skill.name}</h1>
          <p className="text-sm text-muted-foreground">{skill.description}</p>
        </div>
      </div>
      <ComingSoon phase="an upcoming release" entitlement={`${skill.code}.practice`} />
    </>
  );
}

function ComingSoon({ phase, entitlement }: { phase: string; entitlement?: string }) {
  const feature = useFeature(entitlement ?? "");

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Sparkles className="size-4" aria-hidden />
        </div>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Coming in {phase}
          {entitlement && !feature.isPending && (
            <Badge variant={feature.allowed ? "success" : "secondary"}>
              {feature.allowed ? "Included in your plan" : "Requires an upgrade"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          The foundation is ready: this area will use the same API, data and progress on web and mobile.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
