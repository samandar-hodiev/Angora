import type { Metadata } from "next";
import { Suspense } from "react";

import { OwnerLoading } from "@/features/owner/components/primitives";
import { OwnerCmsView } from "@/features/owner/views/cms-view";

export const metadata: Metadata = { title: "Content" };

/**
 * The view reads the query string (?type=speaking from the sidebar), which makes it a
 * client-only read: without this boundary the whole route waits for the browser.
 */
export default function OwnerCmsPage() {
  return (
    <Suspense fallback={<OwnerLoading />}>
      <OwnerCmsView />
    </Suspense>
  );
}
