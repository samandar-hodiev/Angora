import type { Metadata } from "next";

import { IrregularVerbsView } from "@/features/learner/components/irregular-verbs-view";

export const metadata: Metadata = { title: "Irregular verbs" };

export default function Page() {
  return <IrregularVerbsView />;
}
