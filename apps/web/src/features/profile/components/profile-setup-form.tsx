"use client";

import type { Profile } from "@engora/types";
import { profileSetupSchema, type ProfileSetupValues } from "@engora/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { FormField } from "@/components/common/form-field";
import { ErrorState } from "@/components/common/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorReason, usePasswordStatus, useSetPassword, type PasswordStatus } from "@/features/auth/email";
import { onboardingApi } from "@/features/onboarding/api";
import { journeyPath } from "@/features/onboarding/routing";
import { track } from "@/lib/analytics";
import { applyApiErrors } from "@/lib/forms/apply-api-errors";
import { detectCountry, nationalPart, toE164 } from "@/lib/phone";
import { queryKeys } from "@/lib/query/keys";

import { useProfile } from "../hooks";
import { useSetupProfile } from "../setup-api";

import { AvatarUploader } from "./avatar-uploader";
import { PhoneInput } from "./phone-input";

/** Account profile setup: who the learner is. Learning goals come later, in onboarding. */
export function ProfileSetupForm() {
  const profile = useProfile();
  const status = usePasswordStatus();

  if (profile.isPending || status.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-18 w-48 rounded-full" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  return <ProfileSetupFields profile={profile.data} status={status.data} />;
}

function ProfileSetupFields({ profile, status }: { profile: Profile; status: PasswordStatus }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setup = useSetupProfile();
  const setPassword = useSetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  // Email-code accounts need a password to sign in again; Google accounts may add one.
  const passwordRequired = status.auth_provider === "email" && !status.has_password;
  const [showPassword, setShowPassword] = useState(passwordRequired);
  const [country] = useState(() => profile.phone_country ?? detectCountry());

  const form = useForm<ProfileSetupValues>({
    resolver: zodResolver(profileSetupSchema),
    defaultValues: {
      first_name: profile.first_name,
      last_name: profile.last_name,
      phone_country: country,
      phone_number: nationalPart(country, profile.phone_number),
      password: "",
      confirm_password: "",
      password_required: passwordRequired,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const [firstName, phoneCountry] = useWatch({ control: form.control, name: ["first_name", "phone_country"] });

  useEffect(() => {
    track("profile_setup_started");
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const phone = values.phone_number.trim() ? toE164(values.phone_country, values.phone_number) : null;
    if (values.phone_number.trim() && !phone) {
      form.setError("phone_number", { message: "Enter a valid phone number for the selected country" });
      return;
    }
    try {
      if (values.password) {
        try {
          await setPassword.mutateAsync(values.password);
        } catch (error) {
          if (errorReason(error) !== "password_exists") throw error;
        }
      }
      await setup.mutateAsync({
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        phone_country: phone ? values.phone_country : undefined,
        phone_number: phone ?? undefined,
      });
      const state = await queryClient.fetchQuery({ queryKey: queryKeys.onboarding.state, queryFn: onboardingApi.get });
      router.replace(journeyPath(state));
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ["first_name", "last_name", "phone_number", "password"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {formError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <AvatarUploader avatarUrl={profile.avatar_url} name={firstName || profile.display_name} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="first_name" label="First name" error={errors.first_name?.message}>
          <Input autoComplete="given-name" autoFocus {...form.register("first_name")} />
        </FormField>
        <FormField id="last_name" label="Last name" description="Optional" error={errors.last_name?.message}>
          <Input autoComplete="family-name" {...form.register("last_name")} />
        </FormField>
      </div>

      <FormField id="phone_number" label="Phone number" description="Optional · for account recovery later" error={errors.phone_number?.message}>
        <Controller
          control={form.control}
          name="phone_number"
          render={({ field }) => (
            <PhoneInput
              country={phoneCountry}
              number={field.value}
              onCountryChange={(code) => form.setValue("phone_country", code)}
              onNumberChange={field.onChange}
            />
          )}
        />
      </FormField>

      {showPassword ? (
        <fieldset className="grid gap-4 rounded-xl border bg-surface/40 p-4">
          <legend className="px-1 text-label">{passwordRequired ? "Create a password" : "Add a password"}</legend>
          <p className="-mt-2 text-caption text-fg-muted">
            {passwordRequired
              ? "You'll use it with your email to sign in."
              : "Optional. Lets you sign in with your email as well as Google."}
          </p>
          <FormField id="password" label="Password" description="At least 8 characters, with a letter and a number." error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register("password")} />
          </FormField>
          <FormField id="confirm_password" label="Confirm password" error={errors.confirm_password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register("confirm_password")} />
          </FormField>
        </fieldset>
      ) : (
        !status.has_password && (
          <Button type="button" variant="link" className="justify-self-start" onClick={() => setShowPassword(true)}>
            Add a password (optional)
          </Button>
        )
      )}

      <Button type="submit" variant="liquid" size="lg" className="w-full" loading={isSubmitting}>
        Continue
      </Button>
    </form>
  );
}
