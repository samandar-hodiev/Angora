import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { skillsMarketing } from "@/features/marketing/content";
import { SkillLanding } from "@/features/marketing/components/skill-landing";

const skill = skillsMarketing.find((s) => s.code === "reading");

export const metadata: Metadata = {
  title: "Reading practice",
  description: skill?.description,
  alternates: { canonical: "/reading" },
};

export default function ReadingLandingPage() {
  if (!skill) notFound();
  return <SkillLanding skill={skill} />;
}
