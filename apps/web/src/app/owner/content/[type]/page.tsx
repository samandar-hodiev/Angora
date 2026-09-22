import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OwnerLoading } from "@/features/owner/components/primitives";
import { isContentType } from "@/features/owner/components/nav";
import { OwnerCmsView } from "@/features/owner/views/cms-view";

export const metadata: Metadata = { title: "Content" };

/**
 * One content type, at a URL of its own (/owner/content/reading).
 *
 * The same table as "All content" with the filter already applied — one view, one set of
 * behaviours, no second implementation to keep in step. Static segments (grammar,
 * placement, questions) take precedence over this one, so they keep their own pages.
 */
export default async function OwnerContentTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!isContentType(type)) notFound();

  return (
    <Suspense fallback={<OwnerLoading />}>
      <OwnerCmsView initialType={type} />
    </Suspense>
  );
}
