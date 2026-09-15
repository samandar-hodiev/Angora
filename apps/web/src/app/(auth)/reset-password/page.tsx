import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthSwitch, PrivacyLinks } from "@/features/auth/components/auth-parts";
import { ResetPasswordForm } from "@/features/auth/components/password-forms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard
      title="Choose a new password"
      description="You'll be signed out of other devices for your security."
      footer={
        <>
          <AuthSwitch question="Remembered it?" href="/login" action="Sign in" />
          <PrivacyLinks />
        </>
      }
    >
      <ResetPasswordForm token={token ?? ""} />
    </AuthCard>
  );
}
