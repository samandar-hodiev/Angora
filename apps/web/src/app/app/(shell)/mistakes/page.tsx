import type { Metadata } from "next";

import { MistakesView } from "@/features/learner/components/mistakes-view";

export const metadata: Metadata = { title: "Mistakes" };

export default function Page() {
  return <MistakesView />;
}
