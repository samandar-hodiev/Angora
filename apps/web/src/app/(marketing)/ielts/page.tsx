import { ArrowRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ScoreCard } from "@/components/learning/cards";
import { Button } from "@/components/ui/button";
import { ieltsDisclaimer, ieltsHighlights } from "@/features/marketing/content";
import { FinalCTA, PageHero, Section, SectionHeading } from "@/features/marketing/components/sections";

export const metadata: Metadata = {
  title: "IELTS preparation",
  description: "IELTS speaking, writing, reading and listening practice with estimated band scores and full mock exams.",
  alternates: { canonical: "/ielts" },
};

export default function IELTSLandingPage() {
  return (
    <>
      <PageHero
        eyebrow="IELTS mode"
        title="Prepare for IELTS with a coach that knows your weak spots"
        description="Exam-style practice for all four modules, estimated band scores and mock exams in a focused exam mode."
        actions={
          <Button size="lg" asChild>
            <Link href="/register">
              Start preparing <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />

      <Section tone="muted" labelledBy="ielts-what">
        <SectionHeading id="ielts-what" title="Everything for exam day" />
        <ul className="grid gap-4 md:grid-cols-3">
          {ieltsHighlights.map((h) => (
            <li key={h.title} className="grid gap-3 rounded-xl border bg-surface p-6">
              <h.icon className="size-5 text-primary" aria-hidden />
              <h3 className="text-h4">{h.title}</h3>
              <p className="text-body-sm text-fg-secondary">{h.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="ielts-bands">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <SectionHeading
            id="ielts-bands"
            title="Band estimates for every criterion"
            description="Each speaking and writing answer is scored against the public band descriptors, so you know exactly which criterion to work on."
          />
          <div className="grid gap-4">
            <ScoreCard label="Estimated overall band" score={6.5} scale="ielts_band" size="hero" caption="Example estimate — not an official IELTS score" />
            <p className="flex items-start gap-2 text-caption text-fg-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {ieltsDisclaimer}
            </p>
          </div>
        </div>
      </Section>

      <div className="pt-8">
        <FinalCTA title="Your target band starts with one practice" />
      </div>
    </>
  );
}
