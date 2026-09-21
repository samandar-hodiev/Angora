"use client";

import { Image as ImageIcon, Palette, Settings2, ShieldAlert, Sparkles, Users } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { OwnerPageHeader, SectionCard } from "../components/primitives";
import { useLiveSiteSettings, useLiveWallpapers, useUpdateLiveSettings, useUpdateWallpaper } from "../hooks";
import { formatNumber } from "../lib/format";
import type { LiveSiteSettings } from "../types";

/**
 * Platform settings.
 *
 * Everything here is a default. A learner who has already chosen a theme, a daily goal or a
 * wallpaper keeps it — these values are what a new account starts from and what the app falls
 * back to, which is why nothing on this page is phrased as "set for everyone".
 */

const sections = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "learner", label: "Learner defaults", icon: Users },
  { id: "features", label: "Features", icon: Sparkles },
  { id: "wallpapers", label: "Wallpapers", icon: ImageIcon },
  { id: "maintenance", label: "Maintenance", icon: ShieldAlert },
] as const;

type SectionId = (typeof sections)[number]["id"];

export function OwnerSettingsView() {
  const [section, setSection] = useState<SectionId>("general");
  const settings = useLiveSiteSettings();

  return (
    <>
      <OwnerPageHeader
        title="Settings"
        description="Platform defaults. Learners keep any choice they have already made."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Settings" }]}
      />

      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20">
          <ul className="flex gap-1 overflow-x-auto rounded-xl border bg-surface p-1.5 lg:grid lg:overflow-visible">
            {sections.map((entry) => {
              const active = entry.id === section;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSection(entry.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm whitespace-nowrap transition-colors duration-micro",
                      "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      active
                        ? "bg-primary-subtle font-medium text-primary-subtle-foreground"
                        : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    <entry.icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-fg-muted")} aria-hidden />
                    {entry.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-4">
          {settings.isError ? (
            <LiveDataState error={settings.error} onRetry={() => void settings.refetch()} />
          ) : settings.isPending || !settings.data ? (
            <Skeleton className="h-96 w-full" />
          ) : section === "wallpapers" ? (
            <WallpaperLibrary />
          ) : (
            <SettingsGroup section={section} settings={settings.data} />
          )}
        </div>
      </div>
    </>
  );
}

function SettingsGroup({ section, settings }: { section: SectionId; settings: LiveSiteSettings }) {
  const update = useUpdateLiveSettings();
  const [general, setGeneral] = useState(settings.general);
  const [learner, setLearner] = useState(settings.learner);
  const [features, setFeatures] = useState(settings.features);
  const [maintenance, setMaintenance] = useState(settings.maintenance);

  function save(patch: Partial<LiveSiteSettings>, message: string) {
    update.mutate(patch, {
      onSuccess: () => toast({ title: message, description: "New accounts start from these values.", variant: "success" }),
      onError: (error) =>
        toast({
          title: "Those settings were not saved",
          description: isApiError(error) ? error.message : undefined,
          variant: "error",
        }),
    });
  }

  if (section === "general") {
    return (
      <SectionCard
        title="General"
        description="How the platform introduces itself"
        action={
          <Button size="sm" loading={update.isPending} onClick={() => save({ general }, "General settings saved")}>
            Save
          </Button>
        }
      >
        <div className="grid gap-4 sm:max-w-xl">
          <Field label="Site name" id="site-name" value={general.site_name ?? ""} onChange={(v) => setGeneral({ ...general, site_name: v })} />
          <div className="grid gap-1.5">
            <Label htmlFor="site-description">Site description</Label>
            <Textarea
              id="site-description"
              rows={2}
              value={general.site_description ?? ""}
              onChange={(e) => setGeneral({ ...general, site_description: e.target.value })}
            />
          </div>
          <Field label="Support email" id="support-email" value={general.support_email ?? ""} onChange={(v) => setGeneral({ ...general, support_email: v })} />
          <div className="grid gap-1.5">
            <Label htmlFor="timezone">Default timezone</Label>
            <NativeSelect id="timezone" value={general.timezone ?? "UTC"} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })}>
              {["Asia/Tashkent", "Asia/Almaty", "Europe/Moscow", "Europe/London", "UTC"].map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (section === "learner") {
    return (
      <SectionCard
        title="Learner defaults"
        description="What a new account starts with"
        action={
          <Button size="sm" loading={update.isPending} onClick={() => save({ learner }, "Learner defaults saved")}>
            Save
          </Button>
        }
      >
        <div className="grid gap-4 sm:max-w-xl">
          <div className="grid gap-1.5">
            <Label htmlFor="explanation-language">Grammar explanation language</Label>
            <NativeSelect
              id="explanation-language"
              value={learner.explanation_language ?? "uz"}
              onChange={(e) => setLearner({ ...learner, explanation_language: e.target.value })}
            >
              <option value="uz">Uzbek</option>
              <option value="en">English</option>
              <option value="ru">Russian</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="theme">Theme</Label>
            <NativeSelect id="theme" value={learner.theme ?? "dark"} onChange={(e) => setLearner({ ...learner, theme: e.target.value })}>
              <option value="system">Follow the device</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="landing">First page after signing in</Label>
            <NativeSelect id="landing" value={learner.landing_page ?? "dashboard"} onChange={(e) => setLearner({ ...learner, landing_page: e.target.value })}>
              <option value="dashboard">Dashboard</option>
              <option value="learn">Learn</option>
              <option value="grammar">Grammar</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="daily-goal">Daily goal (minutes)</Label>
            <Input
              id="daily-goal"
              type="number"
              min={5}
              max={240}
              value={learner.daily_goal_minutes ?? 15}
              onChange={(e) => setLearner({ ...learner, daily_goal_minutes: Number(e.target.value) || 5 })}
            />
            <p className="text-caption text-fg-muted">Learners who set their own goal keep it.</p>
          </div>
          <Toggle
            id="placement"
            label="Placement test during onboarding"
            hint="New learners are offered it before their first lesson"
            checked={learner.placement_test ?? true}
            onChange={(checked) => setLearner({ ...learner, placement_test: checked })}
          />
        </div>
      </SectionCard>
    );
  }

  if (section === "features") {
    const labels: Record<string, { label: string; hint: string }> = {
      ai_coach: { label: "AI coach", hint: "The open chat surface in the learner app" },
      placement_test: { label: "Placement test", hint: "Available from the learner dashboard at any time" },
      leaderboard: { label: "Leaderboard", hint: "Not built yet — the switch is ready for when it is" },
      public_registration: { label: "Public registration", hint: "Turning this off makes the platform invitation-only" },
      realtime_speaking_coach: { label: "Realtime speaking coach", hint: "Live corrections while the learner speaks" },
    };
    return (
      <SectionCard
        title="Features"
        description="Platform-wide switches. Per-plan access lives on the Paywall page."
        action={
          <Button size="sm" loading={update.isPending} onClick={() => save({ features }, "Feature switches saved")}>
            Save
          </Button>
        }
      >
        <div className="grid gap-3 sm:max-w-xl">
          {Object.entries(labels).map(([key, meta]) => (
            <Toggle
              key={key}
              id={key}
              label={meta.label}
              hint={meta.hint}
              checked={features[key] ?? false}
              onChange={(checked) => setFeatures({ ...features, [key]: checked })}
            />
          ))}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Maintenance"
      description="Take the learner app offline while you work on it"
      action={
        <Button size="sm" loading={update.isPending} onClick={() => save({ maintenance }, "Maintenance settings saved")}>
          Save
        </Button>
      }
    >
      <div className="grid gap-4 sm:max-w-xl">
        <Toggle
          id="maintenance-enabled"
          label="Maintenance mode"
          hint="The learner app shows the message below instead of the product"
          checked={maintenance.enabled ?? false}
          onChange={(checked) => setMaintenance({ ...maintenance, enabled: checked })}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="maintenance-message">Message</Label>
          <Textarea
            id="maintenance-message"
            rows={3}
            value={maintenance.message ?? ""}
            onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value })}
          />
        </div>
        <Toggle
          id="maintenance-owner"
          label="Keep the owner console reachable"
          hint="So you can still work while learners are locked out"
          checked={maintenance.allow_owner_access ?? true}
          onChange={(checked) => setMaintenance({ ...maintenance, allow_owner_access: checked })}
        />
      </div>
    </SectionCard>
  );
}

function WallpaperLibrary() {
  const wallpapers = useLiveWallpapers();
  const update = useUpdateWallpaper();

  if (wallpapers.isError) {
    return (
      <SectionCard title="Wallpapers" description="What learners may choose from">
        <LiveDataState error={wallpapers.error} onRetry={() => void wallpapers.refetch()} />
      </SectionCard>
    );
  }

  const enabled = (wallpapers.data ?? []).filter((w) => w.enabled).length;

  return (
    <SectionCard
      title="Wallpapers"
      description={
        wallpapers.isPending ? "What learners may choose from" : `${enabled} of ${wallpapers.data?.length ?? 0} offered in learner settings`
      }
    >
      {wallpapers.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-2">
          {wallpapers.data?.map((wallpaper) => (
            <li key={wallpaper.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3">
              <Palette className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-2 truncate text-body-sm font-medium">
                  {wallpaper.name}
                  {wallpaper.animated && <Badge variant="secondary">Animated</Badge>}
                </span>
                <span className="text-caption text-fg-muted tabular-nums">
                  {wallpaper.in_use > 0
                    ? `${formatNumber(wallpaper.in_use)} learners are using it`
                    : "No learner has chosen it"}
                </span>
              </div>
              <Switch
                checked={wallpaper.enabled}
                aria-label={`${wallpaper.enabled ? "Withdraw" : "Offer"} ${wallpaper.name}`}
                onCheckedChange={(checked) =>
                  update.mutate(
                    { id: wallpaper.id, input: { enabled: checked } },
                    {
                      onSuccess: () =>
                        toast({
                          title: checked ? `${wallpaper.name} is offered again` : `${wallpaper.name} withdrawn`,
                          description: checked
                            ? undefined
                            : "Learners already using it keep it; it is no longer offered to others.",
                        }),
                    },
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Field({ label, id, value, onChange }: { label: string; id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <Label htmlFor={id} className="grid gap-0.5">
        {label}
        <span className="text-caption font-normal text-fg-muted">{hint}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
