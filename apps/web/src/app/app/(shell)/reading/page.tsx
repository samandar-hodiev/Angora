import type { Metadata } from "next";

import { ReadingView } from "@/features/practice/reading-view";

export const metadata: Metadata = { title: "Reading" };

export default async function ReadingPage({ searchParams }: { searchParams: Promise<{ content?: string }> }) {
  const { content } = await searchParams;
  return <ReadingView initialContentId={content} />;
}
