import type { Metadata } from "next";

import { MockExamHome } from "@/features/mock-exam/learner-home";

export const metadata: Metadata = { title: "Mock exam" };

export default function Page() {
  return <MockExamHome />;
}
