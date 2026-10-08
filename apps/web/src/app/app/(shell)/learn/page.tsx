import type { Metadata } from "next";

import { LearnView } from "@/features/practice/learn-view";

export const metadata: Metadata = { title: "Practice" };

export default function LearnPage() {
  return <LearnView />;
}
