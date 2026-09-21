import type { Metadata } from "next";

import { GrammarCreateView } from "@/features/owner/views/grammar-create-view";

export const metadata: Metadata = { title: "New grammar topic" };

export default function OwnerGrammarCreatePage() {
  return <GrammarCreateView />;
}
