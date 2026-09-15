import type { Metadata } from "next";

import { ListeningView } from "@/features/practice/listening-view";

export const metadata: Metadata = { title: "Listening" };

export default async function ListeningPage({ searchParams }: { searchParams: Promise<{ content?: string }> }) {
  const { content } = await searchParams;
  return <ListeningView initialContentId={content} />;
}
