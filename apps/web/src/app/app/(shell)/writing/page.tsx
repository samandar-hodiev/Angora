import type { Metadata } from "next";

import { WritingView } from "@/features/practice/writing-view";

export const metadata: Metadata = { title: "Writing" };

export default async function WritingPage({ searchParams }: { searchParams: Promise<{ content?: string }> }) {
  const { content } = await searchParams;
  return <WritingView initialContentId={content} />;
}
