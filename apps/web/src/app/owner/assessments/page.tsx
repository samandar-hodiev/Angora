import type { Metadata } from "next";

import { AssessmentsView } from "@/features/owner/views/assessments-view";

export const metadata: Metadata = { title: "Assessments" };

export default function OwnerAssessmentsPage() {
  return <AssessmentsView />;
}
