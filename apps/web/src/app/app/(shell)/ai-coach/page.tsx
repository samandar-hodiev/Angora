import type { Metadata } from "next";

import { AICoachView } from "@/features/learner/components/ai-coach-view";

export const metadata: Metadata = { title: "AI Coach" };

export default function Page() {
  return <AICoachView />;
}
