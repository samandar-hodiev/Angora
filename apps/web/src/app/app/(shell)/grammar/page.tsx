import type { Metadata } from "next";

import { GrammarLibraryView } from "@/features/grammar/components/library-view";

export const metadata: Metadata = {
  title: "Grammar",
  description: "Browse and search every grammar topic, with practice that targets your own mistakes.",
};

export default function Page() {
  return <GrammarLibraryView />;
}
