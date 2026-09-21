import type { Metadata } from "next";

import { OwnerCmsView } from "@/features/owner/views/cms-view";

export const metadata: Metadata = { title: "Content" };

export default function OwnerCmsPage() {
  return <OwnerCmsView />;
}
