import type { Metadata } from "next";

import { GrammarCmsView } from "@/features/owner/views/grammar-cms-view";

export const metadata: Metadata = { title: "Grammar" };

export default function OwnerGrammarCmsPage() {
  return <GrammarCmsView />;
}
