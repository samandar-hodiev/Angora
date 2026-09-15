import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthSwitch, PrivacyLinks } from "@/features/auth/components/auth-parts";
import { RegisterOptions } from "@/features/auth/components/register-options";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Start your personalized English learning journey."
      footer={
        <>
          <AuthSwitch question="Already have an account?" href="/login" action="Log in" />
          <PrivacyLinks />
        </>
      }
    >
      <RegisterOptions />
    </AuthCard>
  );
}
