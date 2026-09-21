import type { Metadata } from "next";

import { LearnersView } from "@/features/owner/views/learners-view";

export const metadata: Metadata = { title: "Learners" };

export default function OwnerLearnersPage() {
  return <LearnersView />;
}
