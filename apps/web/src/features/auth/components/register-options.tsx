"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";

import { SocialAuth } from "./social-auth";

/** Sign-up method choice: Google or email. Account details come later, after verification. */
export function RegisterOptions() {
  useEffect(() => {
    track("signup_started");
  }, []);

  return (
    <div className="grid gap-4">
      <SocialAuth mode="signup" />
      <Button variant="outline" size="lg" className="w-full" asChild>
        <Link href="/register/email" onClick={() => track("signup_email_clicked")}>
          <Mail aria-hidden />
          Continue with email
        </Link>
      </Button>
      <Link
        href="/forgot-password"
        className="justify-self-center text-body-sm text-fg-secondary underline-offset-4 hover:text-primary hover:underline"
      >
        Forgot password?
      </Link>
    </div>
  );
}
