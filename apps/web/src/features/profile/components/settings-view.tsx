"use client";

import { Download, KeyRound, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionCard, Switch } from "@/components/ui/choice";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useLogout, useSession } from "@/features/auth/hooks";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/features/notifications/hooks";
import { useCurrentSubscription } from "@/features/subscription/hooks";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import type { NotificationPreferences } from "@engora/types";
import type { ThemePreference } from "@/lib/theme";
import { useTheme } from "@/providers/theme-provider";

import { saveAsJsonFile, useExportAccount } from "../account";
import { useSaveAppearance } from "../appearance";
import { useProfile } from "../hooks";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { WallpaperPicker } from "./wallpaper-picker";

const sections = [
  ["account", "Account"],
  ["appearance", "Appearance"],
  ["background", "Background"],
  ["notifications", "Notifications"],
  ["learning", "Learning preferences"],
  ["language", "Language"],
  ["privacy", "Privacy"],
  ["security", "Security"],
  ["subscription", "Subscription"],
] as const;

/**
 * The messages a learner may switch off, by template code.
 *
 * Receipts and the welcome message are deliberately not here. A payment confirmation is a
 * record of money changing hands, not marketing, and somebody who switched it off six
 * months ago and then disputes a charge is worse off for it.
 */
const mutableNotifications = [
  { code: "streak_reminder", label: "Streak reminder", description: "A nudge in the evening if you have a streak going and haven't practised." },
  { code: "subscription_expiring", label: "Subscription ending", description: "Three days before a paid period runs out." },
  { code: "level_changed", label: "Level changes", description: "When an assessment moves your CEFR level." },
  { code: "assessment_completed", label: "Assessment results", description: "When a placement test has finished scoring." },
] as const;

function SettingsSection({
  id,
  title,
  description,
  flashed,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  flashed: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      // Jumping here must clear the pinned title, or the section lands underneath it: the offset
      // is the header, the area's padding, the title itself and the gap below it.
      style={{ scrollMarginTop: "calc(var(--app-header-h, 3.5rem) + var(--main-pt, 1.5rem) + var(--page-title-h, 3.5rem) + 1.5rem)" }}
      className={cn(
        // An outline, not a ring: the card glass rule owns box-shadow, and a ring would be
        // overridden by it. The outline fades out on its own when the flash ends.
        "rounded-xl border bg-surface p-6 outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-500",
        // A green edge for a moment after it is picked, so it is obvious where the jump landed.
        flashed && "outline-primary",
      )}
    >
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
  const [selected, setSelected] = useState("");
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);
  const { user } = useSession();
  const profile = useProfile();
  const logout = useLogout();
  const router = useRouter();
  const subscription = useCurrentSubscription();
  const exportAccount = useExportAccount();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { preference } = useTheme();
  const { save: saveAppearance } = useSaveAppearance();

  // Picking a section marks it in the menu and flashes it, so it is clear where the page landed.
  const pick = (id: string) => {
    setSelected(id);
    setFlash({ id, at: Date.now() });
  };

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (id) pick(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const focus = (profile.data?.preferences?.focus_skills ?? []) as string[];

  const signOut = async () => {
    setConfirmSignOut(false);
    await logout.mutateAsync().catch(() => undefined);
    router.replace("/login");
  };

  const downloadData = () => {
    exportAccount.mutate(undefined, {
      onSuccess: (data) => {
        saveAsJsonFile(data, `engora-data-${new Date().toISOString().slice(0, 10)}.json`);
        toast({ title: "Your data has been downloaded", variant: "success" });
      },
      onError: (error) => toast({ title: "That export failed", description: errorMessage(error), variant: "error" }),
    });
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          {/* Its own surface: the section list is the one piece of small text that would otherwise
              sit bare on a learner's wallpaper. It pins directly under the page title — whose
              height the title itself publishes — so the two stay put while the sections scroll
              past, at any width or zoom. The lower z keeps the title on top if they ever meet. */}
          <ul
            style={{ top: "calc(var(--app-header-h, 3.5rem) + var(--main-pt, 1.5rem) + var(--page-title-h, 3.5rem) + 1.5rem)" }}
            className="sticky z-10 grid gap-0.5 rounded-xl border bg-surface p-2"
          >
            {sections.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  onClick={() => pick(id)}
                  aria-current={selected === id ? "true" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-body-sm transition-colors duration-micro",
                    selected === id
                      ? "bg-primary-subtle font-medium text-primary-subtle-foreground"
                      : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid gap-6">
          <SettingsSection flashed={flash?.id === "account"} id="account" title="Account" description="One account for web and the Engora mobile apps.">
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

          <SettingsSection flashed={flash?.id === "appearance"} id="appearance" title="Appearance" description="Saved to your account, so it follows you to other devices.">
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

          <SettingsSection
            flashed={flash?.id === "background"}
            id="background"
            title="Background"
            description="Your own wallpaper behind the learning area. The header and sidebar stay as they are."
          >
            <WallpaperPicker />
          </SettingsSection>

          <SettingsSection
            flashed={flash?.id === "notifications"}
            id="notifications"
            title="Notifications"
            description="Where messages reach you, and which ones."
          >
            <NotificationSettings />
          </SettingsSection>

          <SettingsSection flashed={flash?.id === "learning"} id="learning" title="Learning preferences" description="Level, goals and daily time shape your plan.">
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

          <SettingsSection flashed={flash?.id === "language"} id="language" title="Language">
            <div className="grid max-w-xs gap-2">
              <Label htmlFor="ui-language">Interface language</Label>
              <NativeSelect id="ui-language" defaultValue="en" disabled>
                <option value="en">English</option>
              </NativeSelect>
              <p className="text-caption text-fg-muted">More interface languages are planned.</p>
            </div>
          </SettingsSection>

          <SettingsSection
            flashed={flash?.id === "privacy"}
            id="privacy"
            title="Privacy"
            description="Your record is yours: take a copy whenever you like, or close the account for good."
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" loading={exportAccount.isPending} onClick={downloadData}>
                <Download aria-hidden /> Download my data
              </Button>
              <Button variant="outline" className="text-error" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden /> Delete account
              </Button>
            </div>
            <p className="mt-3 text-caption text-fg-muted">
              The download is a JSON file of everything on your account. Deleting asks for a code sent to your email
              first — it cannot be undone.
            </p>
          </SettingsSection>

          <SettingsSection flashed={flash?.id === "security"} id="security" title="Security">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href="/forgot-password">
                  <KeyRound aria-hidden /> Change password
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setConfirmSignOut(true)} loading={logout.isPending}>
                <LogOut aria-hidden /> Sign out
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection flashed={flash?.id === "subscription"} id="subscription" title="Subscription">
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

      {/* Signing out ends the session on every tab of this browser, so it is asked first. */}
      <Dialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out of Engora?</DialogTitle>
            <DialogDescription>
              You&apos;ll need to sign in again to continue learning. Your progress is saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSignOut(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={logout.isPending} onClick={() => void signOut()}>
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteAccountDialog
        open={deleting}
        onOpenChange={setDeleting}
        accountEmail={user?.email ?? ""}
        planName={subscription.data?.entitlements.plan_name}
        paidPlan={Boolean(subscription.data?.entitlements.plan_code && subscription.data.entitlements.plan_code !== "free")}
      />
    </>
  );
}

/**
 * Delivery preferences, read from and written to the server.
 *
 * A switch here can only ever turn something off. What a template is *allowed* to use is
 * decided by the template itself, in the owner console — so nobody can opt themselves into
 * an email the product never intended to send.
 */
function NotificationSettings() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  if (prefs.isPending) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (prefs.isError) {
    return <ErrorState title="Couldn't load your preferences" error={prefs.error} onRetry={() => void prefs.refetch()} />;
  }

  const current = prefs.data;
  const muted = new Set(current.muted);

  const save = (input: Partial<NotificationPreferences>) =>
    update.mutate(input, {
      onError: (error) => toast({ title: "Couldn't save", description: errorMessage(error), variant: "error" }),
    });

  const toggleMuted = (code: string, enabled: boolean) => {
    const next = new Set(muted);
    if (enabled) next.delete(code);
    else next.add(code);
    save({ muted: [...next] });
  };

  return (
    <div className="grid gap-6">
      <ul className="grid gap-5">
        <li className="flex items-center justify-between gap-4">
          <Label htmlFor="channel-in-app" className="grid gap-1">
            <span>In the app</span>
            <span className="text-caption font-normal text-fg-muted">Shown under the bell in the header.</span>
          </Label>
          <Switch
            id="channel-in-app"
            checked={current.in_app}
            disabled={update.isPending}
            onCheckedChange={(checked) => save({ in_app: checked })}
          />
        </li>
        <li className="flex items-center justify-between gap-4">
          <Label htmlFor="channel-email" className="grid gap-1">
            <span>Email</span>
            <span className="text-caption font-normal text-fg-muted">Only the messages that are worth an inbox.</span>
          </Label>
          <Switch
            id="channel-email"
            checked={current.email}
            disabled={update.isPending}
            onCheckedChange={(checked) => save({ email: checked })}
          />
        </li>
      </ul>

      <div className="grid gap-5 border-t pt-5">
        <p className="text-label text-fg-muted">Which messages</p>
        <ul className="grid gap-5">
          {mutableNotifications.map((item) => (
            <li key={item.code} className="flex items-center justify-between gap-4">
              <Label htmlFor={`n-${item.code}`} className="grid gap-1">
                <span>{item.label}</span>
                <span className="text-caption font-normal text-fg-muted">{item.description}</span>
              </Label>
              <Switch
                id={`n-${item.code}`}
                checked={!muted.has(item.code)}
                disabled={update.isPending}
                onCheckedChange={(checked) => toggleMuted(item.code, checked)}
              />
            </li>
          ))}
        </ul>
        <p className="text-caption text-fg-muted">
          Payment receipts are always sent — they are a record of money changing hands.
        </p>
      </div>
    </div>
  );
}
