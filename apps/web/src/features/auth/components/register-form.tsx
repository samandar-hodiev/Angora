"use client";

import { registerSchema, toRegisterPayload, type RegisterInput } from "@engora/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField } from "@/components/common/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyApiErrors } from "@/lib/forms/apply-api-errors";

import { useRegister } from "../hooks";

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function RegisterForm() {
  const router = useRouter();
  const registerMutation = useRegister();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { display_name: "", email: "", password: "", confirm_password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerMutation.mutateAsync(toRegisterPayload({ ...values, timezone: browserTimezone() }));
      // New learners set up their goal, level and plan before seeing the dashboard.
      router.replace("/onboarding");
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ["display_name", "email", "password"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <FormField id="display_name" label="Name" error={errors.display_name?.message}>
        <Input autoComplete="name" {...form.register("display_name")} />
      </FormField>

      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" placeholder="you@example.com" {...form.register("email")} />
      </FormField>

      <FormField id="password" label="Password" description="At least 8 characters." error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>

      <FormField id="confirm_password" label="Confirm password" error={errors.confirm_password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("confirm_password")} />
      </FormField>

      <Button type="submit" className="w-full" loading={isSubmitting}>
        Create account
      </Button>

      <p className="text-center text-caption text-fg-muted">
        By creating an account you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          Privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
