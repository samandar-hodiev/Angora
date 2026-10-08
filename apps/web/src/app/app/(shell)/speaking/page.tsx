import type { Metadata } from "next";

import { CoachStudioView } from "@/features/practice/coach/coach-studio-view";
import { SpeakingView } from "@/features/practice/speaking-view";

export const metadata: Metadata = { title: "Speaking" };

/**
 * Speaking opens on the realtime coach. The single-recording flow stays for the links that
 * ask for it: a specific task (?content=), a grammar topic's task (?topic=), or ?mode=record.
 */
export default async function SpeakingPage({
  searchParams,
}: {
  searchParams: Promise<{ content?: string; topic?: string; mode?: string }>;
}) {
  const { content, topic, mode } = await searchParams;
  if (content || topic || mode === "record") {
    return <SpeakingView initialContentId={content} grammarTopic={topic} />;
  }
  return <CoachStudioView />;
}
