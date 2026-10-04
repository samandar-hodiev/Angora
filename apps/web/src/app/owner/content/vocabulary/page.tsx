import type { Metadata } from "next";

import { VocabularyView } from "@/features/owner/views/vocabulary-view";

export const metadata: Metadata = { title: "Vocabulary" };

/** The vocabulary library has a page of its own: words are added and generated, not filtered. */
export default function OwnerVocabularyPage() {
  return <VocabularyView />;
}
