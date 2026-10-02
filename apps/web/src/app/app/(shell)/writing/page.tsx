import type { Metadata } from "next";

import { WritingView } from "@/features/practice/writing-view";

export const metadata: Metadata = { title: "Writing" };

export default async function WritingPage({
  searchParams,
}: {
  searchParams: Promise<{ content?: string; topic?: string }>;
}) {
  const { content, topic } = await searchParams;
  return <WritingView initialContentId={content} grammarTopic={topic} />;
}
