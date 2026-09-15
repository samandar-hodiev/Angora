import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { SocialAuth } from "@/features/auth/components/social-auth";
import { safeRedirect } from "@/lib/navigation";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const redirectTo = safeRedirect(next);
  return (
    <AuthCard
      title="Welcome back"
      description="Log in to continue learning."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <SocialAuth mode="signin" redirectTo={redirectTo} />
      <LoginForm redirectTo={redirectTo} />
    </AuthCard>
  );
}
