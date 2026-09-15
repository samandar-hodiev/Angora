import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthSwitch, PrivacyLinks } from "@/features/auth/components/auth-parts";
import { ForgotPasswordForm } from "@/features/auth/components/password-forms";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send you instructions to reset your password."
      footer={
        <>
          <AuthSwitch question="Remembered it?" href="/login" action="Sign in" />
          <PrivacyLinks />
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
