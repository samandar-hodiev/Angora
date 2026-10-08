import type { Metadata } from "next";

import { MockExamView } from "@/features/owner/views/mock-exam-view";

export const metadata: Metadata = { title: "Mock exam" };

export default function OwnerMockExamPage() {
  return <MockExamView />;
}
