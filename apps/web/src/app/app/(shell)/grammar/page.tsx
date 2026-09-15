import type { Metadata } from "next";

import { GrammarView } from "@/features/learner/components/grammar-view";

export const metadata: Metadata = { title: "Grammar" };

export default function Page() {
  return <GrammarView />;
}
