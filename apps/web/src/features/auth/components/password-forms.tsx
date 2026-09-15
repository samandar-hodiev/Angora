"use client";

import { forgotPasswordSchema, resetPasswordSchema, type ForgotPasswordInput, type ResetPasswordInput } from "@engora/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, MailCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField } from "@/components/common/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyApiErrors } from "@/lib/forms/apply-api-errors";

import { useForgotPassword, useResetPassword } from "../password";

function Done({ icon: Icon, title, text, action }: { icon: typeof MailCheck; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div role="status" className="grid justify-items-center gap-3 py-2 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-h4">{title}</p>
      <p className="text-body-sm text-fg-secondary">{text}</p>
      {action}
    </div>
  );
}

export function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await forgot.mutateAsync(email);
      setSent(true);
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ["email"]));
    }
  });

  if (sent) {
    return (
      <Done
        icon={MailCheck}
        title="Check your email"
        text="If an account exists for that address, we've sent a link to reset your password. It expires in one hour."
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
        <Input type="email" autoComplete="email" placeholder="you@example.com" {...form.register("email")} />
      </FormField>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const reset = useResetPassword();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  if (!token) {
    return (
      <Done
        icon={CircleAlert}
        title="This link is incomplete"
        text="Open the link from your email again, or request a new one."
        action={
          <Button variant="outline" asChild>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        }
      />
    );
  }

  if (done) {
    return (
      <Done
        icon={ShieldCheck}
        title="Password updated"
        text="You can now log in with your new password."
        action={
          <Button asChild>
            <Link href="/login">Log in</Link>
          </Button>
        }
      />
    );
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await reset.mutateAsync({ token, password });
      setDone(true);
    } catch (error) {
      const message = applyApiErrors(error, form.setError, ["password"]);
      setFormError(message === "Invalid request" ? "This reset link is invalid or has expired. Request a new one." : message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>
            {formError}{" "}
            <Link href="/forgot-password" className="underline underline-offset-4">
              Get a new link
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <FormField id="password" label="New password" description="At least 8 characters." error={form.formState.errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <FormField id="confirm_password" label="Confirm new password" error={form.formState.errors.confirm_password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("confirm_password")} />
      </FormField>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Update password
      </Button>
    </form>
  );
}
