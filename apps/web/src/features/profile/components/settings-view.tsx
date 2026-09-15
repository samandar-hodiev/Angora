"use client";

import { Download, KeyRound, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OptionCard, Switch } from "@/components/ui/choice";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { useLogout, useSession } from "@/features/auth/hooks";
import { useCurrentSubscription } from "@/features/subscription/hooks";
import { errorMessage } from "@/lib/api/errors";
import type { ThemePreference } from "@/lib/theme";
import { useTheme } from "@/providers/theme-provider";

import { useSaveAppearance } from "../appearance";
import { useProfile, useUpdateProfile } from "../hooks";

const sections = [
  ["account", "Account"],
  ["appearance", "Appearance"],
  ["notifications", "Notifications"],
  ["learning", "Learning preferences"],
  ["language", "Language"],
  ["privacy", "Privacy"],
  ["security", "Security"],
  ["subscription", "Subscription"],
] as const;

const notificationOptions = [
  { key: "daily_reminder", label: "Daily practice reminder", description: "A gentle nudge if you haven't practised today." },
  { key: "weekly_report", label: "Weekly progress report", description: "Your skill changes and focus for next week." },
  { key: "product_updates", label: "Product updates", description: "New features and learning content." },
] as const;

function SettingsSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-xl border bg-surface p-6">
      <div className="mb-5 grid gap-1">
        <h2 id={`${id}-title`} className="text-h3">
          {title}
        </h2>
        {description && <p className="text-body-sm text-fg-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function SettingsView() {
  const { user } = useSession();
  const profile = useProfile();
  const update = useUpdateProfile();
  const logout = useLogout();
  const router = useRouter();
  const subscription = useCurrentSubscription();
  const { preference } = useTheme();
  const { save: saveAppearance } = useSaveAppearance();

  const notifications = (profile.data?.preferences?.notifications ?? {}) as Record<string, boolean>;
  const focus = (profile.data?.preferences?.focus_skills ?? []) as string[];

  const setNotification = (key: string, enabled: boolean) => {
    update.mutate(
      { preferences: { notifications: { ...notifications, [key]: enabled } } },
      { onError: (error) => toast({ title: "Couldn't save", description: errorMessage(error), variant: "error" }) },
    );
  };

  const signOut = async () => {
    await logout.mutateAsync().catch(() => undefined);
    router.replace("/login");
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-20 grid gap-0.5">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-3 py-1.5 text-body-sm text-fg-secondary hover:bg-surface-hover hover:text-foreground">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid gap-6">
          <SettingsSection id="account" title="Account" description="One account for web and the Engora mobile apps.">
            <dl className="grid gap-4 text-body-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-fg-muted">Email</dt>
              <dd className="break-all">{user?.email}</dd>
              <dt className="text-fg-muted">Role</dt>
              <dd>
                <Badge variant="secondary">{user?.role}</Badge>
              </dd>
              <dt className="text-fg-muted">Member since</dt>
              <dd>{user ? new Date(user.created_at).toLocaleDateString(undefined, { dateStyle: "long" }) : ""}</dd>
            </dl>
          </SettingsSection>

          <SettingsSection id="appearance" title="Appearance" description="Saved to your account, so it follows you to other devices.">
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
              {(
                [
                  ["light", "Light", Sun],
                  ["dark", "Dark", Moon],
                  ["system", "System", Monitor],
                ] as [ThemePreference, string, typeof Sun][]
              ).map(([value, label, Icon]) => (
                <OptionCard key={value} role="radio" aria-checked={preference === value} selected={preference === value} onClick={() => saveAppearance(value)}>
                  <Icon className="size-5 text-primary" aria-hidden />
                  {label}
                </OptionCard>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection id="notifications" title="Notifications">
            <ul className="grid gap-5">
              {notificationOptions.map((opt) => (
                <li key={opt.key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`n-${opt.key}`} className="grid gap-1">
                    <span>{opt.label}</span>
                    <span className="text-caption font-normal text-fg-muted">{opt.description}</span>
                  </Label>
                  <Switch
                    id={`n-${opt.key}`}
                    checked={notifications[opt.key] ?? opt.key !== "product_updates"}
                    disabled={!profile.data || update.isPending}
                    onCheckedChange={(checked) => setNotification(opt.key, checked)}
                  />
                </li>
              ))}
            </ul>
          </SettingsSection>

          <SettingsSection id="learning" title="Learning preferences" description="Level, goals and daily time shape your plan.">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {profile.data?.current_level && <Badge variant="secondary">Level {profile.data.current_level}</Badge>}
                {profile.data && <Badge variant="outline">{profile.data.daily_goal_minutes} min / day</Badge>}
                {focus.map((f) => (
                  <Badge key={f} variant="outline" className="capitalize">
                    {f}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link href="/app/profile">Edit profile</Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/app/dashboard#assessments">Find my level again</Link>
                </Button>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection id="language" title="Language">
            <div className="grid max-w-xs gap-2">
              <Label htmlFor="ui-language">Interface language</Label>
              <NativeSelect id="ui-language" defaultValue="en" disabled>
                <option value="en">English</option>
              </NativeSelect>
              <p className="text-caption text-fg-muted">More interface languages are planned.</p>
            </div>
          </SettingsSection>

          <SettingsSection id="privacy" title="Privacy" description="Self-service export and deletion are on the way. Until then, contact support.">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled>
                <Download aria-hidden /> Download my data
              </Button>
              <Button variant="outline" disabled className="text-error">
                <Trash2 aria-hidden /> Delete account
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection id="security" title="Security">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href="/forgot-password">
                  <KeyRound aria-hidden /> Change password
                </Link>
              </Button>
              <Button variant="outline" onClick={() => void signOut()} loading={logout.isPending}>
                <LogOut aria-hidden /> Sign out
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection id="subscription" title="Subscription">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-body">
                Current plan: <span className="font-medium">{subscription.data?.entitlements.plan_name ?? "…"}</span>
              </p>
              <Button asChild>
                <Link href="/app/subscription">Manage plan</Link>
              </Button>
            </div>
          </SettingsSection>
        </div>
      </div>
    </>
  );
}
