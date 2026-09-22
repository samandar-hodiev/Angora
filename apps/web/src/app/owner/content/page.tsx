import type { Metadata } from "next";

import { ContentOverview } from "@/features/owner/views/content-overview";

export const metadata: Metadata = { title: "Content CMS" };

export default function OwnerContentPage() {
  return <ContentOverview />;
}
