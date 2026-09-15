import type { Metadata } from "next";

import { JourneyShell } from "@/components/journey/journey-shell";
import { LevelFlow } from "@/features/onboarding/components/level-flow";

export const metadata: Metadata = { title: "Your English level" };

export default function LevelPage() {
  return (
    <JourneyShell width="step" brand>
      <LevelFlow />
    </JourneyShell>
  );
}
