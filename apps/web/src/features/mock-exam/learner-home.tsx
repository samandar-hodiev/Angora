"use client";

import type { CEFRLevel } from "./sample";
import { ArrowRight, BookOpenText, Clock, Headphones, ListChecks, Mic, PenLine, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/features/profile/hooks";
import { cn } from "@/lib/utils";

import { mockSkillLabels, mockSkills, sampleSection, type MockSkill } from "./sample";

const levels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const mockSkillIcons: Record<MockSkill, LucideIcon> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

const skillNotes: Record<MockSkill, string> = {
  listening: "The recording plays once. Read the questions first, then press Play.",
  reading: "A passage and its questions side by side. Move between questions freely.",
  writing: "Timed essay. Copy and paste are off; writing stops when time is up.",
  speaking: "A cue card, time to prepare, then you record your answer.",
};

/**
 * Mock exam — the learner's way into a timed exam at a level they choose.
 *
 * It opens on the learner's own level; picking another level changes which exam they get.
 * Each skill is its own sitting, so a learner can do one today and another tomorrow.
 */
export function MockExamHome() {
  const profile = useProfile();
  const own = (profile.data?.current_level ?? null) as CEFRLevel | null;
  const [picked, setPicked] = useState<CEFRLevel | null>(null);
  const level = picked ?? own ?? "A2";

  return (
    <>
      <PageHeader
        title="Mock exam"
        description="A timed exam at your level, the way the real one feels — no hints, no pauses, results at the end."
      />

      <section aria-labelledby="mock-level" className="mb-6 grid gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="mock-level" className="text-h4">
            Exam level
          </h2>
          <span className="text-caption text-fg-muted">
            {own ? (
              <>
                Your level is <span className="font-medium text-foreground">{own}</span> — choose another to try a harder or easier exam
              </>
            ) : (
              "Choose the level you want to be tested at"
            )}
          </span>
        </div>
        <div role="radiogroup" aria-label="Exam level" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {levels.map((code) => {
            const active = code === level;
            return (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPicked(code)}
                className={cn(
                  "relative grid h-14 place-items-center rounded-xl border text-h4 font-semibold outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  active ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
                )}
              >
                {code}
                {code === own && (
                  <span className="absolute top-1 right-1.5 text-[0.625rem] font-medium tracking-wide text-fg-muted uppercase">you</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="mock-sections" className="grid gap-3">
        <h2 id="mock-sections" className="text-h4">
          Sections
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {mockSkills.map((skill) => {
            const section = sampleSection(skill, level);
            const Icon = mockSkillIcons[skill];
            const count = section.questions?.length;
            return (
              <article key={skill} className="flex flex-col gap-4 rounded-xl border bg-surface p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-h4">{mockSkillLabels[skill]}</h3>
                      <Badge variant="outline">{level}</Badge>
                    </div>
                    <p className="text-body-sm text-fg-secondary">{skillNotes[skill]}</p>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-4 text-caption text-fg-muted">
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5" aria-hidden /> {section.minutes} min
                  </span>
                  {count !== undefined && (
                    <span className="flex items-center gap-1.5">
                      <ListChecks className="size-3.5" aria-hidden /> {count} questions
                    </span>
                  )}
                  {section.task && <span>{section.task.minWords}+ words</span>}
                  {section.cueCard && <span>1 min to prepare · 2 min to speak</span>}
                  <Button asChild size="sm" className="ml-auto">
                    <Link href={`/app/mock-exam/${skill}?level=${level}`}>
                      Start <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
