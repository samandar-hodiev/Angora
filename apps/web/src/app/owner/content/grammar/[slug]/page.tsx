import type { Metadata } from "next";
import { Suspense } from "react";

import { OwnerLoading } from "@/features/owner/components/primitives";
import { GrammarTopicEditorView } from "@/features/owner/views/grammar-topic-editor";

export const metadata: Metadata = { title: "Grammar topic" };

export default async function OwnerGrammarTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<OwnerLoading />}>
      <GrammarTopicEditorView slug={slug} />
    </Suspense>
  );
}
