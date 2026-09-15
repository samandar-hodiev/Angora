import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { skillsMarketing } from "@/features/marketing/content";
import { SkillLanding } from "@/features/marketing/components/skill-landing";

const skill = skillsMarketing.find((s) => s.code === "speaking");

export const metadata: Metadata = {
  title: "Speaking practice",
  description: skill?.description,
  alternates: { canonical: "/speaking" },
};

export default function SpeakingLandingPage() {
  if (!skill) notFound();
  return <SkillLanding skill={skill} />;
}
