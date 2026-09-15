import type { Metadata } from "next";

import { ProgressView } from "@/features/learner/components/progress-view";

export const metadata: Metadata = { title: "Progress" };

export default function Page() {
  return <ProgressView />;
}
