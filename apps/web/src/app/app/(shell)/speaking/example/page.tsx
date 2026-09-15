import type { Metadata } from "next";

import { SpeakingExampleReport } from "@/features/practice/speaking-example";

export const metadata: Metadata = { title: "Example speaking analysis" };

export default function SpeakingExamplePage() {
  return <SpeakingExampleReport />;
}
