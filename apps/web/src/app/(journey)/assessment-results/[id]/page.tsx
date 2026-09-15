import type { Metadata } from "next";

import { JourneyShell } from "@/components/journey/journey-shell";
import { ResultsView } from "@/features/assessment/components/results-view";

export const metadata: Metadata = { title: "Your estimated English level" };

export default async function AssessmentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <JourneyShell width="wide" brand center={false}>
      <ResultsView id={id} />
    </JourneyShell>
  );
}
