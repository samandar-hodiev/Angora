import type { Metadata } from "next";

import { IELTSView } from "@/features/learner/components/ielts-view";

export const metadata: Metadata = { title: "IELTS" };

export default function Page() {
  return <IELTSView />;
}
