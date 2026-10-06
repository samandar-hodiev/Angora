import type { Metadata } from "next";

import { IrregularVerbsView } from "@/features/owner/views/irregular-verbs-view";

export const metadata: Metadata = { title: "Irregular verbs" };

export default function Page() {
  return <IrregularVerbsView />;
}
