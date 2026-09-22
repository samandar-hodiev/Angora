import type { Metadata } from "next";
import { Suspense } from "react";

import { OwnerLoading } from "@/features/owner/components/primitives";
import { GrammarBuilderView } from "@/features/owner/views/grammar-builder-view";

export const metadata: Metadata = { title: "Grammar content" };

/**
 * One grammar topic, written across its CEFR levels and languages.
 *
 * The view reads ?lang from the query string, which makes it a client-only read: without
 * this boundary the whole route would wait for the browser.
 */
export default async function OwnerGrammarTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<OwnerLoading />}>
      <GrammarBuilderView slug={slug} />
    </Suspense>
  );
}
