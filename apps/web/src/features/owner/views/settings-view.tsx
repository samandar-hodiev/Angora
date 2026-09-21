"use client";

import { ArrowDown, ArrowUp, Eye, Image as ImageIcon, Palette, Settings2, ShieldAlert, Sparkles, Users } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { OwnerPageHeader, SearchInput, SectionCard } from "../components/primitives";
import { useMoveWallpaper, useSetWallpaperEnabled, useSiteSettings, useUpdateSiteSettings, useWallpapers } from "../hooks";
import { formatNumber } from "../lib/format";
import type { SiteSettings, Wallpaper } from "../types";

const sections = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "learner", label: "Learner defaults", icon: Users },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "wallpapers", label: "Wallpapers", icon: ImageIcon },
  { id: "features", label: "Feature defaults", icon: Sparkles },
  { id: "maintenance", label: "Maintenance", icon: ShieldAlert },
] as const;

type SectionId = (typeof sections)[number]["id"];

export function OwnerSettingsView() {
  const [section, setSection] = useState<SectionId>("general");
  const settings = useSiteSettings();

  return (
    <>
      <OwnerPageHeader
        title="Site settings"
        description="Defaults for the platform and the learner experience."
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
          {settings.isPending || !settings.data ? (
            <Skeleton className="h-96 w-full" />
          ) : section === "general" ? (
            <GeneralSettings settings={settings.data} />
          ) : section === "learner" ? (
            <LearnerDefaults settings={settings.data} />
          ) : section === "appearance" ? (
            <AppearanceSettings settings={settings.data} />
          ) : section === "wallpapers" ? (
            <WallpaperLibrary />
          ) : section === "features" ? (
            <FeatureDefaults settings={settings.data} />
          ) : (
            <MaintenanceSettings settings={settings.data} />
          )}
        </div>
      </div>
    </>
  );
}

function useSave() {
  const update = useUpdateSiteSettings();
  return {
    pending: update.isPending,
    save: (patch: Partial<SiteSettings>, message: string) =>
      update.mutate(patch, {
        onSuccess: () => toast({ title: message, variant: "success" }),
        onError: () => toast({ title: "Those settings were not saved", variant: "error" }),
      }),
  };
}

function GeneralSettings({ settings }: { settings: SiteSettings }) {
  const { save, pending } = useSave();
  const [general, setGeneral] = useState(settings.general);

  return (
    <SectionCard
      title="General"
      description="How the platform introduces itself"
      action={
        <Button size="sm" loading={pending} onClick={() => save({ general }, "General settings saved")}>
          Save
        </Button>
      }
    >
      <div className="grid gap-4 sm:max-w-xl">
        <div className="grid gap-1.5">
          <Label htmlFor="site-name">Site name</Label>
          <Input id="site-name" value={general.site_name} onChange={(e) => setGeneral({ ...general, site_name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="site-description">Site description</Label>
          <Textarea
            id="site-description"
            rows={2}
            value={general.site_description}
            onChange={(e) => setGeneral({ ...general, site_description: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="support-email">Support email</Label>
          <Input
            id="support-email"
            type="email"
            value={general.support_email}
            onChange={(e) => setGeneral({ ...general, support_email: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="timezone">Default timezone</Label>
          <NativeSelect id="timezone" value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })}>
            {["Asia/Tashkent", "Asia/Almaty", "Europe/Moscow", "Europe/London", "UTC"].map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label>Logo</Label>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">E</span>
            <div className="grid gap-0.5">
              <p className="text-body-sm">Using the built-in Engora mark</p>
              <p className="text-caption text-fg-muted">
                Uploading a logo needs the object-storage endpoint that serves avatars today.
              </p>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function LearnerDefaults({ settings }: { settings: SiteSettings }) {
  const { save, pending } = useSave();
  const [defaults, setDefaults] = useState(settings.learner_defaults);

  return (
    <SectionCard
      title="Learner defaults"
      description="What a new account starts with — existing learners keep their own choices"
      action={
        <Button size="sm" loading={pending} onClick={() => save({ learner_defaults: defaults }, "Learner defaults saved")}>
          Save
        </Button>
      }
    >
      <div className="grid gap-4 sm:max-w-xl">
        <div className="grid gap-1.5">
          <Label htmlFor="interface-language">Interface language</Label>
          <NativeSelect
            id="interface-language"
            value={defaults.interface_language}
            onChange={(e) => setDefaults({ ...defaults, interface_language: e.target.value as typeof defaults.interface_language })}
          >
            <option value="uz">Uzbek</option>
            <option value="en">English</option>
            <option value="ru">Russian</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="explanation-language">Grammar explanation language</Label>
          <NativeSelect
            id="explanation-language"
            value={defaults.explanation_language}
            onChange={(e) =>
              setDefaults({ ...defaults, explanation_language: e.target.value as typeof defaults.explanation_language })
            }
          >
            <option value="uz">Uzbek</option>
            <option value="en">English</option>
            <option value="ru">Russian</option>
          </NativeSelect>
          <p className="text-caption text-fg-muted">
            Separate from the interface language: a learner can read the app in English and the grammar in Uzbek.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="landing-page">First page after signing in</Label>
          <NativeSelect
            id="landing-page"
            value={defaults.landing_page}
            onChange={(e) => setDefaults({ ...defaults, landing_page: e.target.value as typeof defaults.landing_page })}
          >
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
            max={180}
            value={defaults.daily_goal_minutes}
            onChange={(e) => setDefaults({ ...defaults, daily_goal_minutes: Number(e.target.value) || 5 })}
          />
        </div>
        <ToggleRow
          id="placement-test"
          label="Placement test during onboarding"
          hint="New learners are asked to take it before their first lesson"
          checked={defaults.onboarding_placement_test}
          onChange={(checked) => setDefaults({ ...defaults, onboarding_placement_test: checked })}
        />
      </div>
    </SectionCard>
  );
}

function AppearanceSettings({ settings }: { settings: SiteSettings }) {
  const { save, pending } = useSave();
  const [theme, setTheme] = useState(settings.learner_defaults.theme);

  return (
    <>
      <SectionCard
        title="Appearance"
        description="The default look of the learner app"
        action={
          <Button
            size="sm"
            loading={pending}
            onClick={() => save({ learner_defaults: { ...settings.learner_defaults, theme } }, "Appearance saved")}
          >
            Save
          </Button>
        }
      >
        <fieldset className="grid gap-2 sm:max-w-md">
          <legend className="mb-1 text-label">Default theme</legend>
          {(["system", "dark", "light"] as const).map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-body-sm capitalize transition-colors duration-micro",
                theme === option ? "border-primary bg-primary-subtle" : "hover:bg-surface-hover",
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option}
                checked={theme === option}
                onChange={() => setTheme(option)}
                className="size-4 accent-[var(--primary)]"
              />
              {option}
              {option === "system" && <span className="text-caption text-fg-muted">Follows the device</span>}
            </label>
          ))}
        </fieldset>
      </SectionCard>

      <SectionCard title="Wallpapers" description="Manage the library learners choose from">
        <p className="text-body-sm text-fg-secondary">
          Thirty backgrounds ship with the app. Switching one off removes it from learner Settings without affecting
          anyone who already has it selected.
        </p>
      </SectionCard>
    </>
  );
}

function WallpaperLibrary() {
  const wallpapers = useWallpapers();
  const setEnabled = useSetWallpaperEnabled();
  const move = useMoveWallpaper();
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Wallpaper | null>(null);

  const items = (wallpapers.data ?? []).filter((wallpaper) =>
    wallpaper.name.toLowerCase().includes(search.toLowerCase()),
  );
  const enabledCount = (wallpapers.data ?? []).filter((wallpaper) => wallpaper.enabled).length;

  return (
    <>
      <SectionCard
        title="Wallpaper library"
        description={`${enabledCount} of ${wallpapers.data?.length ?? 0} available to learners`}
        action={<SearchInput value={search} onChange={setSearch} label="Search wallpapers" placeholder="Search" />}
      >
        {wallpapers.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-40 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-fg-muted">No wallpaper matches &ldquo;{search}&rdquo;.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((wallpaper, index) => (
              <li key={wallpaper.id} className="grid overflow-hidden rounded-xl border bg-surface">
                <button
                  type="button"
                  onClick={() => setPreview(wallpaper)}
                  aria-label={`Preview ${wallpaper.name}`}
                  className="group relative h-24 w-full bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <span aria-hidden className="absolute inset-0" style={{ backgroundImage: wallpaper.preview }} />
                  <span
                    aria-hidden
                    className="absolute inset-0 grid place-items-center bg-foreground/40 text-background opacity-0 transition-opacity duration-micro group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <Eye className="size-4" />
                  </span>
                  {wallpaper.animated && (
                    <Badge variant="secondary" className="absolute top-2 right-2">
                      Animated
                    </Badge>
                  )}
                </button>
                <div className="grid gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="grid min-w-0 gap-0.5">
                      <p className="truncate text-body-sm font-medium">{wallpaper.name}</p>
                      <p className="text-caption text-fg-muted tabular-nums">
                        {wallpaper.enabled ? `${formatNumber(wallpaper.usage_count)} learners use it` : "Hidden from learners"}
                      </p>
                    </div>
                    <Switch
                      checked={wallpaper.enabled}
                      aria-label={`${wallpaper.enabled ? "Disable" : "Enable"} ${wallpaper.name}`}
                      onCheckedChange={(checked) =>
                        setEnabled.mutate(
                          { id: wallpaper.id, enabled: checked },
                          {
                            onSuccess: () =>
                              toast({
                                title: checked ? `${wallpaper.name} enabled` : `${wallpaper.name} hidden`,
                                description: checked
                                  ? "It now appears in learner Settings."
                                  : "Learners can no longer select it.",
                              }),
                          },
                        )
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${wallpaper.name} up`}
                      disabled={index === 0 || move.isPending}
                      onClick={() => move.mutate({ id: wallpaper.id, direction: "up" })}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${wallpaper.name} down`}
                      disabled={index === items.length - 1 || move.isPending}
                      onClick={() => move.mutate({ id: wallpaper.id, direction: "down" })}
                    >
                      <ArrowDown />
                    </Button>
                    <span className="ml-auto text-caption text-fg-muted tabular-nums">#{wallpaper.order}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>How it looks behind the learner&apos;s content area</DialogDescription>
          </DialogHeader>
          <div className="relative aspect-[16/9] overflow-hidden rounded-xl border bg-background">
            <span aria-hidden className="absolute inset-0" style={{ backgroundImage: preview?.preview }} />
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="w-full max-w-sm rounded-xl border bg-surface/80 p-4 backdrop-blur">
                <p className="text-label">Today&apos;s plan</p>
                <p className="mt-1 text-caption text-fg-muted">Sample learner card over the wallpaper</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setPreview(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FeatureDefaults({ settings }: { settings: SiteSettings }) {
  const { save, pending } = useSave();
  const [features, setFeatures] = useState(settings.features);

  return (
    <SectionCard
      title="Feature defaults"
      description="Platform-wide switches. Per-plan access lives on the Paywall page."
      action={
        <Button size="sm" loading={pending} onClick={() => save({ features }, "Feature defaults saved")}>
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:max-w-xl">
        <ToggleRow
          id="ai-coach"
          label="AI coach"
          hint="The open chat surface in the learner app"
          checked={features.ai_coach_enabled}
          onChange={(checked) => setFeatures({ ...features, ai_coach_enabled: checked })}
        />
        <ToggleRow
          id="placement"
          label="Placement test"
          hint="Available from the learner dashboard at any time"
          checked={features.placement_test_enabled}
          onChange={(checked) => setFeatures({ ...features, placement_test_enabled: checked })}
        />
        <ToggleRow
          id="leaderboard"
          label="Leaderboard"
          hint="Not built yet — the switch is ready for when it is"
          checked={features.leaderboard_enabled}
          onChange={(checked) => setFeatures({ ...features, leaderboard_enabled: checked })}
        />
        <ToggleRow
          id="registration"
          label="Public registration"
          hint="Turning this off makes the platform invitation-only"
          checked={features.public_registration}
          onChange={(checked) => setFeatures({ ...features, public_registration: checked })}
        />
      </div>
    </SectionCard>
  );
}

function MaintenanceSettings({ settings }: { settings: SiteSettings }) {
  const { save, pending } = useSave();
  const [maintenance, setMaintenance] = useState(settings.maintenance);

  return (
    <SectionCard
      title="Maintenance"
      description="Take the learner app offline while you work on it"
      action={
        <Button size="sm" loading={pending} onClick={() => save({ maintenance }, "Maintenance settings saved")}>
          Save
        </Button>
      }
    >
      <div className="grid gap-4 sm:max-w-xl">
        <ToggleRow
          id="maintenance-enabled"
          label="Maintenance mode"
          hint="Learners see the message below instead of the app"
          checked={maintenance.enabled}
          onChange={(checked) => setMaintenance({ ...maintenance, enabled: checked })}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="maintenance-message">Message</Label>
          <Textarea
            id="maintenance-message"
            rows={3}
            value={maintenance.message}
            onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value })}
          />
        </div>
        <ToggleRow
          id="maintenance-owner"
          label="Keep the owner console reachable"
          hint="So you can still work while learners are locked out"
          checked={maintenance.allow_owner_access}
          onChange={(checked) => setMaintenance({ ...maintenance, allow_owner_access: checked })}
        />
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption">
          Stored in the mock configuration. Taking the app down for real needs the API to serve this flag — the switch
          here is the interface for that, not the mechanism.
        </p>
      </div>
    </SectionCard>
  );
}

function ToggleRow({
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
