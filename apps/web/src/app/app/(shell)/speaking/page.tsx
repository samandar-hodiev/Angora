import type { Metadata } from "next";

import { SpeakingView } from "@/features/practice/speaking-view";

export const metadata: Metadata = { title: "Speaking" };

export default async function SpeakingPage({
  searchParams,
}: {
  searchParams: Promise<{ content?: string; topic?: string }>;
}) {
  const { content, topic } = await searchParams;
  return <SpeakingView initialContentId={content} grammarTopic={topic} />;
}
