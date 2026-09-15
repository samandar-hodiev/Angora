import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { skillsMarketing } from "@/features/marketing/content";
import { SkillLanding } from "@/features/marketing/components/skill-landing";

const skill = skillsMarketing.find((s) => s.code === "writing");

export const metadata: Metadata = {
  title: "Writing practice",
  description: skill?.description,
  alternates: { canonical: "/writing" },
};

export default function WritingLandingPage() {
  if (!skill) notFound();
  return <SkillLanding skill={skill} />;
}
