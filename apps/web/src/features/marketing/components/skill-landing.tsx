import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SkillIcon } from "@/components/learning/skill-icon";

import type { SkillMarketing } from "../content";
import { FinalCTA, PageHero, Section, SectionHeading } from "./sections";

export function SkillLanding({ skill }: { skill: SkillMarketing }) {
  return (
    <>
      <PageHero
        eyebrow={skill.title}
        title={skill.headline}
        description={skill.description}
        actions={
          <>
            <Button size="lg" asChild>
              <Link href="/register">
                Start practising <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/features">All features</Link>
            </Button>
          </>
        }
      />

      <Section labelledBy="skill-how">
        <SectionHeading id="skill-how" eyebrow="How it works" title={`${skill.title} practice in three steps`} />
        <ol className="grid gap-4 md:grid-cols-3">
          {skill.steps.map((step, i) => (
            <li key={step.title} className="grid gap-3 rounded-xl border bg-surface p-6">
              <span className="grid size-8 place-items-center rounded-full bg-primary-subtle text-label text-primary-subtle-foreground tabular-nums">
                {i + 1}
              </span>
              <h3 className="text-h4">{step.title}</h3>
              <p className="text-body-sm text-fg-secondary">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="muted" labelledBy="skill-points">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <span className="mb-4 grid size-11 place-items-center rounded-xl bg-primary-subtle text-primary-subtle-foreground">
              <SkillIcon code={skill.code} className="size-5" />
            </span>
            <h2 id="skill-points" className="text-h1">
              What you get
            </h2>
          </div>
          <ul className="grid gap-3">
            {skill.points.map((point) => (
              <li key={point} className="flex items-start gap-3 rounded-lg border bg-surface p-4 text-body">
                <Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <div className="pt-16">
        <FinalCTA title={`Start ${skill.title.toLowerCase()} practice today`} />
      </div>
    </>
  );
}
