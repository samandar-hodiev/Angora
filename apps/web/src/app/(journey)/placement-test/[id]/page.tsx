import type { Metadata } from "next";

import { AssessmentRunner } from "@/features/assessment/components/assessment-runner";

export const metadata: Metadata = { title: "Placement assessment" };

export default async function PlacementTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentRunner id={id} />;
}
