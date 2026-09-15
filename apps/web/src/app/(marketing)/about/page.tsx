import type { Metadata } from "next";

import { FinalCTA, PageHero, Section } from "@/features/marketing/components/sections";

export const metadata: Metadata = {
  title: "About",
  description: "Engora's mission: give every English learner a patient, personal coach.",
  alternates: { canonical: "/about" },
};

const principles = [
  { title: "Feedback over scores", text: "A number tells you where you are. An explanation tells you how to move forward." },
  { title: "Your mistakes, your plan", text: "Practice should target what you get wrong, not what a generic course expects." },
  { title: "Honest AI", text: "We label estimates as estimates and never present AI output as official results." },
  { title: "One learner, every device", text: "Your progress belongs to your account, on the web today and on mobile next." },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Engora"
        title="A patient, personal English coach for everyone"
        description="Good coaching changes how fast people learn, but it has never been available to most learners. Engora uses AI to make it personal, affordable and always on."
      />
      <Section tone="muted" labelledBy="principles">
        <h2 id="principles" className="mb-8 text-h2">
          What we believe
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {principles.map((p) => (
            <li key={p.title} className="grid gap-2 rounded-xl border bg-surface p-6">
              <h3 className="text-h4">{p.title}</h3>
              <p className="text-body-sm text-fg-secondary">{p.text}</p>
            </li>
          ))}
        </ul>
      </Section>
      <div className="pt-20">
        <FinalCTA />
      </div>
    </>
  );
}
