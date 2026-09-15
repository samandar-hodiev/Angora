import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { skillsMarketing } from "@/features/marketing/content";
import { SkillLanding } from "@/features/marketing/components/skill-landing";

const skill = skillsMarketing.find((s) => s.code === "listening");

export const metadata: Metadata = {
  title: "Listening practice",
  description: skill?.description,
  alternates: { canonical: "/listening" },
};

export default function ListeningLandingPage() {
  if (!skill) notFound();
  return <SkillLanding skill={skill} />;
}
