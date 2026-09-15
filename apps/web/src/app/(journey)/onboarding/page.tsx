import type { Metadata } from "next";

import { JourneyShell } from "@/components/journey/journey-shell";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";

export const metadata: Metadata = { title: "Set up your learning" };

export default function OnboardingPage() {
  return (
    <JourneyShell width="step" brand>
      <OnboardingFlow />
    </JourneyShell>
  );
}
