import type { Metadata } from "next";

import { LiveSpeakingView } from "@/features/practice/live-speaking-view";

export const metadata: Metadata = { title: "Live coach" };

export default function Page() {
  return <LiveSpeakingView />;
}
