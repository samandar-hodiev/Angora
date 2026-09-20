import type { Metadata } from "next";
import { Suspense } from "react";

import { GrammarPracticeView } from "@/features/grammar/components/practice-view";

export const metadata: Metadata = { title: "Practice" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // useSearchParams (mode, rule) needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <GrammarPracticeView slug={slug} />
    </Suspense>
  );
}
