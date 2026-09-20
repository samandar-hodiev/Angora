import type { Metadata } from "next";
import { Suspense } from "react";

import { GrammarTopicView } from "@/features/grammar/components/topic-view";

// The topic's own content is behind the learner's session, so the metadata is built from
// the slug rather than fetched: enough for a readable tab and a shared link, with no
// private data in it.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return {
    title: name,
    description: `${name} — the rule, examples, common mistakes and practice.`,
    alternates: { canonical: `/app/grammar/${slug}` },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // The view reads ?compare= with useSearchParams, which needs a boundary above it.
  return (
    <Suspense fallback={null}>
      <GrammarTopicView slug={slug} />
    </Suspense>
  );
}
