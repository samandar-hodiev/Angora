import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { SocialAuth } from "@/features/auth/components/social-auth";
import { safeRedirect } from "@/lib/navigation";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthCard
      title="Welcome back"
      description="Log in to continue learning."
      footer={
        <>
          New to Engora?{" "}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <SocialAuth />
      <LoginForm redirectTo={safeRedirect(next)} />
    </AuthCard>
  );
}
