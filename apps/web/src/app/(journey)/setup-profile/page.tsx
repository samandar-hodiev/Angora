import type { Metadata } from "next";

import { JourneyShell } from "@/components/journey/journey-shell";
import { AuthCard } from "@/features/auth/components/auth-card";
import { PrivacyLinks } from "@/features/auth/components/auth-parts";
import { ProfileSetupForm } from "@/features/profile/components/profile-setup-form";

export const metadata: Metadata = { title: "Tell us about yourself" };

export default function SetupProfilePage() {
  return (
    <JourneyShell width="form">
      <AuthCard title="Tell us about yourself" description="This helps us personalize your experience." footer={<PrivacyLinks />}>
        <ProfileSetupForm />
      </AuthCard>
    </JourneyShell>
  );
}
