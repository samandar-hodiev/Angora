import type { Metadata } from "next";

import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthSwitch, PrivacyLinks } from "@/features/auth/components/auth-parts";
import { LoginForm } from "@/features/auth/components/login-form";
import { SocialAuth } from "@/features/auth/components/social-auth";
import { safeRedirect } from "@/lib/navigation";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  const redirectTo = safeRedirect(next);
  return (
    <AuthCard
      title="Welcome back"
      description="Continue your English learning journey."
      footer={
        <>
          <AuthSwitch question="Don't have an account?" href="/register" action="Create account" />
          <PrivacyLinks />
        </>
      }
    >
      <SocialAuth mode="signin" redirectTo={redirectTo} />
      <LoginForm redirectTo={redirectTo} defaultEmail={email} />
    </AuthCard>
  );
}
