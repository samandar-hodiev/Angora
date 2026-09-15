"use client";

import { emailStartSchema, type EmailStartInput } from "@engora/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField } from "@/components/common/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyApiErrors } from "@/lib/forms/apply-api-errors";

import { errorReason, useStartEmailSignup } from "../email";
import { saveChallenge } from "../email-challenge";

/** First email sign-up step: only the email address. The API sends a verification code. */
export function EmailStartForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const router = useRouter();
  const start = useStartEmailSignup();
  const [registered, setRegistered] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<EmailStartInput>({ resolver: zodResolver(emailStartSchema), defaultValues: { email: defaultEmail } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setFormError(null);
    setRegistered(null);
    try {
      const challenge = await start.mutateAsync(email);
      saveChallenge(challenge);
      router.push(`/verify-email?email=${encodeURIComponent(challenge.email)}`);
    } catch (error) {
      if (errorReason(error) === "email_registered") {
        setRegistered(email.trim());
        return;
      }
      setFormError(applyApiErrors(error, form.setError, ["email"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {registered && (
        <Alert role="alert">
          <UserRound />
          <AlertDescription className="grid gap-2">
            <p className="font-medium text-foreground">This email is already registered.</p>
            <p>Log in to continue, or reset your password if you&apos;ve forgotten it.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" asChild>
                <Link href={`/login?email=${encodeURIComponent(registered)}`}>Log in</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/forgot-password">Forgot password?</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {formError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <FormField id="email" label="Email address" error={form.formState.errors.email?.message}>
        <Input type="email" autoComplete="email" inputMode="email" autoFocus placeholder="you@example.com" {...form.register("email")} />
      </FormField>
      <Button type="submit" variant="liquid" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Continue
      </Button>
    </form>
  );
}
