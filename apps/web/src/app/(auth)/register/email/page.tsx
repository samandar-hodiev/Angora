import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthSwitch, PrivacyLinks } from "@/features/auth/components/auth-parts";
import { EmailStartForm } from "@/features/auth/components/email-start-form";

export const metadata: Metadata = { title: "Create account with email", robots: { index: false } };

export default async function RegisterEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthCard
      title="Create your account"
      description="Enter your email to continue."
      footer={
        <>
          <AuthSwitch question="Already have an account?" href="/login" action="Log in" />
          <PrivacyLinks />
        </>
      }
    >
      <EmailStartForm defaultEmail={email ?? ""} />
      <Link
        href="/register"
        className="inline-flex items-center justify-self-center gap-1.5 text-body-sm text-fg-secondary underline-offset-4 hover:text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Other ways to sign up
      </Link>
    </AuthCard>
  );
}
