import type { Metadata } from "next";

import { OwnerAIView } from "@/features/owner/views/ai-view";

export const metadata: Metadata = { title: "AI & Team Activity" };

export default function OwnerAIPage() {
  return <OwnerAIView />;
}
