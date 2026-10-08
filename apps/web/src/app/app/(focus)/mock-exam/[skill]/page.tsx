import type { CEFRLevel } from "@/features/mock-exam/sample";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MockExamRunner } from "@/features/mock-exam/exam-runner";
import { mockSkills, type MockSkill } from "@/features/mock-exam/sample";

export const metadata: Metadata = { title: "Mock exam" };

const levels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ skill: string }>;
  searchParams: Promise<{ level?: string }>;
}) {
  const { skill } = await params;
  const { level } = await searchParams;
  if (!(mockSkills as string[]).includes(skill)) notFound();
  const picked = levels.find((code) => code === level) ?? "A2";
  return <MockExamRunner skill={skill as MockSkill} level={picked} />;
}
