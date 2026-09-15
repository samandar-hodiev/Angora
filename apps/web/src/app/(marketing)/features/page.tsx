import { Check } from "lucide-react";
import type { Metadata } from "next";

import { featureGroups } from "@/features/marketing/content";
import { FinalCTA, PageHero, Section } from "@/features/marketing/components/sections";

export const metadata: Metadata = {
  title: "Features",
  description: "Speaking, writing, reading and listening practice with AI feedback, mistake tracking, a personal plan and IELTS preparation.",
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="One coach for every part of your English"
        description="Practice, feedback, personalisation and progress — designed to work together."
      />
      {featureGroups.map((group, i) => (
        <Section key={group.title} tone={i % 2 === 0 ? "muted" : "default"} labelledBy={`group-${i}`}>
          <h2 id={`group-${i}`} className="mb-8 text-h2">
            {group.title}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => (
              <li key={item.title} className="grid gap-2 rounded-xl border bg-surface p-6">
                <Check className="size-5 text-primary" aria-hidden />
                <h3 className="text-h4">{item.title}</h3>
                <p className="text-body-sm text-fg-secondary">{item.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      ))}
      <div className="pt-20">
        <FinalCTA />
      </div>
    </>
  );
}
