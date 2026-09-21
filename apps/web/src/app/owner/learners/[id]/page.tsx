import type { Metadata } from "next";

import { LearnerDetailView } from "@/features/owner/views/learner-detail-view";

export const metadata: Metadata = { title: "Learner" };

export default async function OwnerLearnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LearnerDetailView id={id} />;
}
