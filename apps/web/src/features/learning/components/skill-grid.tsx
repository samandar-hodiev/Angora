"use client";

import {
  AudioLines,
  BookOpenText,
  Headphones,
  Mic,
  PenLine,
  Shapes,
  SpellCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { ErrorState } from "@/components/common/states";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useSkills } from "../hooks";

/** Presentation only: unknown skill codes from the API fall back to a generic icon. */
const skillIcons: Record<string, LucideIcon> = {
  speaking: Mic,
  writing: PenLine,
  reading: BookOpenText,
  listening: Headphones,
  grammar: Shapes,
  vocabulary: SpellCheck,
  pronunciation: AudioLines,
};

export function SkillIcon({ code, className }: { code: string; className?: string }) {
  const Icon = skillIcons[code] ?? Sparkles;
  return <Icon className={className} aria-hidden />;
}

export function SkillGrid() {
  const { data: skills, isPending, isError, error, refetch } = useSkills();

  if (isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <ErrorState title="Couldn't load skills" error={error} onRetry={() => void refetch()} />;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {skills.map((skill) => (
        <li key={skill.id}>
          <Link
            href={`/app/${skill.code}`}
            className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Card className="h-full gap-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
              <CardHeader>
                <div className="mb-2 grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <SkillIcon code={skill.code} className="size-5" />
                </div>
                <CardTitle>{skill.name}</CardTitle>
                <CardDescription>{skill.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
