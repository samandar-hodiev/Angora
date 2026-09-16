"use client";

import type { Profile } from "@engora/types";
import { profileUpdateSchema } from "@engora/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/common/form-field";
import { ErrorState } from "@/components/common/states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLevels } from "@/features/learning/hooks";
import { applyApiErrors } from "@/lib/forms/apply-api-errors";

import { useProfile, useUpdateProfile } from "../hooks";

const formSchema = profileUpdateSchema
  .pick({ current_level: true, target_level: true })
  .extend({
    display_name: z.string().trim().min(1, "Name is required").max(80),
    daily_goal_minutes: z.number({ error: "Enter a number" }).int().min(5, "At least 5 minutes").max(240, "At most 240 minutes"),
  });

type FormValues = z.infer<typeof formSchema>;

const fields = ["display_name", "current_level", "target_level", "daily_goal_minutes"] as const;

export function ProfileCard() {
  const { data: profile, isPending, isError, error, refetch } = useProfile();

  if (isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (isError) return <ErrorState title="Couldn't load your profile" error={error} onRetry={() => void refetch()} />;

  // The heading lives outside the card (see ProfileView), like every other section.
  return (
    <div className="grid gap-5 rounded-xl border bg-surface p-5">
      <p className="text-body-sm text-fg-secondary">Used to personalise practice. Synced across all your devices.</p>
      <ProfileForm profile={profile} />
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const levels = useLevels();
  const update = useUpdateProfile();
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      display_name: profile.display_name,
      current_level: profile.current_level ?? undefined,
      target_level: profile.target_level ?? undefined,
      daily_goal_minutes: profile.daily_goal_minutes,
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(null);
    try {
      const saved = await update.mutateAsync({
        ...values,
        current_level: values.current_level || undefined,
        target_level: values.target_level || undefined,
      });
      form.reset({
        display_name: saved.display_name,
        current_level: saved.current_level ?? undefined,
        target_level: saved.target_level ?? undefined,
        daily_goal_minutes: saved.daily_goal_minutes,
      });
      setStatus({ type: "success", message: "Profile saved" });
    } catch (error) {
      const message = applyApiErrors(error, form.setError, fields);
      if (message) setStatus({ type: "error", message });
    }
  });

  const levelOptions = levels.data ?? [];

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {status && (
        <Alert variant={status.type === "error" ? "destructive" : "info"}>
          {status.type === "error" ? <CircleAlert /> : <CircleCheck />}
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      )}

      <FormField id="display_name" label="Name" error={errors.display_name?.message}>
        <Input autoComplete="name" {...form.register("display_name")} />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="current_level" label="Current level" error={errors.current_level?.message}>
          <NativeSelect disabled={levels.isPending} {...form.register("current_level")}>
            <option value="">Not sure yet</option>
            {levelOptions.map((level) => (
              <option key={level.id} value={level.code}>
                {level.code} · {level.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        <FormField id="target_level" label="Target level" error={errors.target_level?.message}>
          <NativeSelect disabled={levels.isPending} {...form.register("target_level")}>
            <option value="">Not set</option>
            {levelOptions.map((level) => (
              <option key={level.id} value={level.code}>
                {level.code} · {level.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      <FormField
        id="daily_goal_minutes"
        label="Daily goal (minutes)"
        description="Between 5 and 240 minutes."
        error={errors.daily_goal_minutes?.message}
      >
        <Input type="number" inputMode="numeric" min={5} max={240} {...form.register("daily_goal_minutes", { valueAsNumber: true })} />
      </FormField>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
