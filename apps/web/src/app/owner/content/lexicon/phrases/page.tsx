import type { Metadata } from "next";

import { VocabularyView } from "@/features/owner/views/vocabulary-view";

export const metadata: Metadata = { title: "Phrases" };

export default function Page() {
  return <VocabularyView kind="phrase" />;
}
