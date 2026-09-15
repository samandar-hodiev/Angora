import type { Metadata } from "next";

import { VocabularyView } from "@/features/learner/components/vocabulary-view";

export const metadata: Metadata = { title: "Vocabulary" };

export default function Page() {
  return <VocabularyView />;
}
