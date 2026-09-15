import { UnknownSkillView } from "@/features/practice/learn-view";

/** Skills added in the database without a dedicated page yet. */
export default async function SkillPage({ params }: { params: Promise<{ skill: string }> }) {
  const { skill } = await params;
  return <UnknownSkillView code={skill} />;
}
