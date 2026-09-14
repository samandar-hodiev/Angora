import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { SkillGrid } from "@/features/learning/components/skill-grid";

export const metadata: Metadata = { title: "Learn" };

export default function LearnPage() {
  return (
    <>
      <PageHeader title="Learn" description="Choose a skill to practise." />
      <SkillGrid />
    </>
  );
}
