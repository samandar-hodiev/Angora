"use client";

import { loginSchema, type LoginInput } from "@engora/validation";
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

import { useLogin } from "../hooks";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const loginMutation = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await loginMutation.mutateAsync(values);
      router.replace(redirectTo);
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ["email", "password"]));
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

      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" placeholder="you@example.com" {...form.register("email")} />
      </FormField>

      <div className="grid gap-2">
        <FormField id="password" label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register("password")} />
        </FormField>
        <Link href="/forgot-password" className="justify-self-end text-caption text-fg-secondary underline-offset-4 hover:text-primary hover:underline">
          Forgot password?
        </Link>
      </div>

      <Button type="submit" className="w-full" loading={isSubmitting}>
        Log in
      </Button>
    </form>
  );
}
