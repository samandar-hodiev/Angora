import type { Metadata } from "next";

import { ExamView } from "@/features/learner/components/exam-view";

export const metadata: Metadata = { title: "IELTS exam mode" };

export default async function ExamPage({ searchParams }: { searchParams: Promise<{ content?: string }> }) {
  const { content } = await searchParams;
  return <ExamView contentId={content} />;
}
