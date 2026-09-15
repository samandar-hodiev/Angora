import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/components/auth-card";
import { PrivacyLinks } from "@/features/auth/components/auth-parts";
import { VerifyEmailForm } from "@/features/auth/components/verify-email-form";

export const metadata: Metadata = { title: "Check your email", robots: { index: false } };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthCard
      icon={<MailCheck aria-hidden />}
      title="Check your email"
      description="We sent a verification code to your email address."
      footer={<PrivacyLinks />}
    >
      {email ? (
        <VerifyEmailForm email={email} />
      ) : (
        <div className="grid justify-items-center gap-3 text-center">
          <p className="text-body-sm text-fg-secondary">Start by entering the email you want to use.</p>
          <Button asChild>
            <Link href="/register/email">Enter your email</Link>
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
