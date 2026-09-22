"use client";

import {
  Accessibility,
  Bell,
  Globe,
  ImageOff,
  KeyRound,
  Monitor,
  Moon,
  PanelLeft,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OptionCard, Switch } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/features/auth/hooks";
import { isApiError } from "@/lib/api";
import { AuroraCurtain } from "@/features/profile/components/wallpaper-layer";
import { cn } from "@/lib/utils";
import { isAnimatedPreset, presetById, wallpaperPresets } from "@/lib/wallpapers";

import { LiveDataState } from "../components/live-state";
import { ConfirmDialog, KeyValue, OwnerPageHeader, SectionCard } from "../components/primitives";
import {
  useOwnerPreferences,
  useOwnerSessions,
  useOwnerSignIns,
  useRemoveOwnerWallpaper,
  useRevokeOtherOwnerSessions,
  useRevokeOwnerSession,
  useUpdateOwnerPreferences,
  useUploadOwnerWallpaper,
} from "../hooks";
import { ownerLocales, ownerWallpaperImage, useOwnerConsole } from "../preferences";
import type { OwnerLocale, OwnerTheme } from "../types";

/**
 * The Owner Console's own settings.
 *
 * Everything on this page changes the console and only the console. The Learner App's
 * configuration — what learners get by default, which features exist for them, whether the
 * platform is in maintenance — is a different page, a different API and a different table.
 * Mixing the two is what made the old "Settings" page ambiguous, and it is the one thing
 * this page must never do again.
 *
 * Nothing here is decorative. Sessions are the tokens that actually grant access; sign-ins
 * are the audit trail; two-factor is shown as unavailable because the API has no second
 * factor, and a switch that pretends otherwise is worse than no switch.
 */

const MAX_WALLPAPER_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

const sections = [
  { id: "general", icon: Settings2 },
  { id: "language", icon: Globe },
  { id: "appearance", icon: Monitor },
  { id: "sidebar", icon: PanelLeft },
  { id: "notifications", icon: Bell },
  { id: "security", icon: ShieldCheck },
  { id: "sessions", icon: Smartphone },
  { id: "accessibility", icon: Accessibility },
] as const;

type SectionId = (typeof sections)[number]["id"];

export function OwnerSettingsView() {
  const { t } = useOwnerConsole();
  const query = useOwnerPreferences();
  const [section, setSection] = useState<SectionId>("general");

  return (
    <>
      <OwnerPageHeader
        title={t.settings.title}
        description={t.settings.description}
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: t.settings.title }]}
      />

      <p className="mb-5 flex flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-4 py-2.5 text-caption text-fg-muted">
        <Smartphone className="size-3.5 shrink-0" aria-hidden />
        {t.settings.notLearnerApp}
        <Link href="/owner/learner-app" className="text-foreground underline underline-offset-2">
          {t.nav.learnerApp}
        </Link>
      </p>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label={t.settings.title} className="lg:sticky lg:top-20">
          <ul className="flex gap-1 overflow-x-auto rounded-xl border bg-surface p-1.5 lg:grid lg:overflow-visible">
            {sections.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? "true" : undefined}
                  className={cn(
                    "flex w-full shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-body-sm transition-colors duration-micro",
                    section === item.id
                      ? "bg-primary-subtle font-medium text-primary-subtle-foreground"
                      : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {t.settings.sections[item.id]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid gap-4">
          {query.isError ? (
            <LiveDataState error={query.error} onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <Skeleton className="h-80 rounded-xl" />
          ) : (
            <Section id={section} />
          )}
        </div>
      </div>
    </>
  );
}

function Section({ id }: { id: SectionId }) {
  switch (id) {
    case "general":
      return <General />;
    case "language":
      return <Language />;
    case "appearance":
      return <Appearance />;
    case "sidebar":
      return <Sidebar />;
    case "notifications":
      return <Alerts />;
    case "security":
      return <Security />;
    case "sessions":
      return <Sessions />;
    case "accessibility":
      return <AccessibilitySection />;
  }
}

/** Saves one field and says so, or says why not. */
function useSave() {
  const update = useUpdateOwnerPreferences();
  const { t } = useOwnerConsole();
  return {
    pending: update.isPending,
    save: (input: Record<string, unknown>) =>
      update.mutate(input, {
        onSuccess: () => toast({ title: t.settings.saved, variant: "success" }),
        onError: (error) =>
          toast({
            title: t.settings.saveFailed,
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
      }),
  };
}

function General() {
  const { t, prefs, formatDateTime } = useOwnerConsole();
  const { save, pending } = useSave();
  const user = useSession().user;
  const [timezone, setTimezone] = useState(prefs.timezone);

  return (
    <SectionCard title={t.settings.general.title} description={t.settings.general.description}>
      <dl className="mb-5 grid">
        <KeyValue label={t.settings.general.email}>{user?.email ?? "—"}</KeyValue>
        <KeyValue label={t.settings.general.role}>
          <Badge variant="secondary">{user?.role ?? "—"}</Badge>
        </KeyValue>
      </dl>

      <div className="grid gap-4 sm:max-w-lg">
        <div className="grid gap-1.5">
          <Label htmlFor="owner-timezone">{t.settings.general.timezone}</Label>
          <Input
            id="owner-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            onBlur={() => timezone !== prefs.timezone && save({ timezone })}
            placeholder="Asia/Tashkent"
          />
          <p className="text-caption text-fg-muted">{t.settings.general.timezoneHint}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="owner-date-format">{t.settings.general.dateFormat}</Label>
            <NativeSelect
              id="owner-date-format"
              value={prefs.date_format}
              disabled={pending}
              onChange={(e) => save({ date_format: e.target.value })}
            >
              <option value="dmy">31.12.2026</option>
              <option value="mdy">12/31/2026</option>
              <option value="iso">2026-12-31</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="owner-time-format">{t.settings.general.timeFormat}</Label>
            <NativeSelect
              id="owner-time-format"
              value={prefs.time_format}
              disabled={pending}
              onChange={(e) => save({ time_format: e.target.value })}
            >
              <option value="24h">23:45</option>
              <option value="12h">11:45 PM</option>
            </NativeSelect>
          </div>
        </div>

        <p className="rounded-lg border bg-surface-subtle p-3 text-body-sm">
          <span className="text-fg-muted">{t.settings.general.preview}: </span>
          <span className="tabular-nums">{formatDateTime(new Date().toISOString())}</span>
        </p>
      </div>
    </SectionCard>
  );
}

function Language() {
  const { t, prefs } = useOwnerConsole();
  const { save, pending } = useSave();

  return (
    <SectionCard title={t.settings.language.title} description={t.settings.language.description}>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t.settings.language.title}>
        {ownerLocales.map((locale) => (
          <OptionCard
            key={locale.code}
            role="radio"
            aria-checked={prefs.locale === locale.code}
            selected={prefs.locale === locale.code}
            onClick={() => !pending && save({ locale: locale.code satisfies OwnerLocale })}
          >
            <Globe className="size-5 text-primary" aria-hidden />
            {locale.label}
          </OptionCard>
        ))}
      </div>
      <p className="mt-3 text-caption text-fg-muted">{t.settings.language.partial}</p>
    </SectionCard>
  );
}

function Appearance() {
  const { t, prefs } = useOwnerConsole();
  const { save, pending } = useSave();

  const themes: { value: OwnerTheme; label: string; icon: typeof Sun }[] = [
    { value: "system", label: t.settings.appearance.system, icon: Monitor },
    { value: "dark", label: t.settings.appearance.dark, icon: Moon },
    { value: "light", label: t.settings.appearance.light, icon: Sun },
  ];

  return (
    <div className="grid gap-4">
      <SectionCard title={t.settings.appearance.title} description={t.settings.appearance.description}>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t.settings.appearance.theme}>
          {themes.map((theme) => (
            <OptionCard
              key={theme.value}
              role="radio"
              aria-checked={prefs.theme === theme.value}
              selected={prefs.theme === theme.value}
              onClick={() => !pending && save({ theme: theme.value })}
            >
              <theme.icon className="size-5 text-primary" aria-hidden />
              {theme.label}
            </OptionCard>
          ))}
        </div>
        <p className="mt-3 text-caption text-fg-muted">{t.settings.appearance.independent}</p>
      </SectionCard>

      <WallpaperCard />
    </div>
  );
}

function WallpaperCard() {
  const { t, prefs, wallpaperImage } = useOwnerConsole();
  const { save } = useSave();
  const upload = useUploadOwnerWallpaper();
  const remove = useRemoveOwnerWallpaper();
  const input = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const wallpaper = prefs.wallpaper;
  const hasCustom = Boolean(wallpaper.url);

  function pick(file: File | undefined) {
    if (!file) return;
    // Checked here for a fast, clear answer, and again on the server because that is the
    // check that actually matters.
    if (file.size > MAX_WALLPAPER_BYTES) {
      toast({ title: t.settings.wallpaper.tooLarge, variant: "error" });
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      toast({ title: t.settings.wallpaper.wrongType, variant: "error" });
      return;
    }
    upload.mutate(file, {
      onSuccess: () => toast({ title: t.settings.saved, variant: "success" }),
      onError: (error) =>
        toast({
          title: t.settings.saveFailed,
          description: isApiError(error) ? error.message : undefined,
          variant: "error",
        }),
    });
  }

  return (
    <SectionCard title={t.settings.wallpaper.title} description={t.settings.wallpaper.description}>
      <div className="grid gap-5">
        {/* What the console will actually look like, dimmed exactly as it will be. */}
        <div className="relative aspect-[16/5] overflow-hidden rounded-lg border bg-surface-subtle">
          {wallpaperImage ? (
            <>
              <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: wallpaperImage }} />
              {isAnimatedPreset(presetById(wallpaper.preset)) && <AuroraCurtain />}
              <span className="absolute inset-0 bg-background" style={{ opacity: wallpaper.overlay / 100 }} />
              <span className="absolute inset-0 grid place-items-center text-body-sm text-fg-secondary">
                {t.settings.general.preview}
              </span>
            </>
          ) : (
            <span className="absolute inset-0 grid place-items-center text-body-sm text-fg-muted">
              {t.settings.wallpaper.none}
            </span>
          )}
        </div>

        {/* The same eleven built-ins the learner app offers, from the same definitions.
            They are gradients, so choosing one costs no request and no storage. */}
        <div
          role="radiogroup"
          aria-label={t.settings.wallpaper.builtIn}
          className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
        >
          <Swatch
            label={t.settings.wallpaper.noneOption}
            image={null}
            selected={wallpaper.preset === "none"}
            onSelect={() => save({ wallpaper_preset: "none" })}
          />
          {wallpaperPresets.map((preset) => (
            <Swatch
              key={preset.id}
              label={preset.label}
              image={preset.image}
              animated={isAnimatedPreset(preset)}
              selected={wallpaper.preset === preset.id}
              onSelect={() => save({ wallpaper_preset: preset.id })}
            />
          ))}
          {hasCustom && (
            <Swatch
              label={t.settings.wallpaper.yours}
              image={ownerWallpaperImage({ ...wallpaper, preset: "custom" })}
              selected={wallpaper.preset === "custom"}
              onSelect={() => save({ wallpaper_preset: "custom" })}
            />
          )}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <input
            ref={input}
            type="file"
            accept={ACCEPTED.join(",")}
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={upload.isPending} onClick={() => input.current?.click()}>
              <Upload aria-hidden />
              {hasCustom ? t.settings.wallpaper.replace : t.settings.wallpaper.upload}
            </Button>
            {hasCustom && (
              <Button variant="ghost" className="text-error" onClick={() => setConfirmRemove(true)}>
                <Trash2 aria-hidden />
                {t.settings.wallpaper.remove}
              </Button>
            )}
          </div>
          <p className="text-caption text-fg-muted">{t.settings.wallpaper.rules}</p>
        </div>

        {wallpaper.preset !== "none" && (
          <div className="grid gap-1.5 border-t pt-4">
            <Label htmlFor="owner-overlay">
              {t.settings.wallpaper.overlay} — {wallpaper.overlay}%
            </Label>
            <input
              id="owner-overlay"
              type="range"
              min={0}
              max={100}
              step={5}
              defaultValue={wallpaper.overlay}
              className="accent-[var(--primary)]"
              onPointerUp={(e) => save({ wallpaper_overlay: Number(e.currentTarget.value) })}
              onKeyUp={(e) => save({ wallpaper_overlay: Number(e.currentTarget.value) })}
            />
            <p className="text-caption text-fg-muted">{t.settings.wallpaper.overlayHint}</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t.settings.wallpaper.remove}
        description={t.settings.wallpaper.removeHint}
        confirmLabel={t.settings.wallpaper.remove}
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(undefined, {
            onSuccess: () => toast({ title: t.settings.saved, variant: "success" }),
          });
          setConfirmRemove(false);
        }}
      />
    </SectionCard>
  );
}

/** One background in the picker. A radio, so arrow keys walk the set. */
function Swatch({
  label,
  image,
  animated,
  selected,
  onSelect,
}: {
  label: string;
  image: string | null;
  animated?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "grid gap-1.5 rounded-lg border p-1.5 text-left outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/40",
      )}
    >
      <span
        aria-hidden
        className="relative grid h-12 place-items-center overflow-clip rounded-md border bg-surface-active bg-cover bg-center"
        style={image ? { backgroundImage: image } : undefined}
      >
        {!image && <ImageOff className="size-4 text-fg-muted" />}
        {/* The moving preset previews itself, so the swatch shows what the console gets. */}
        {animated && <AuroraCurtain />}
      </span>
      <span className="truncate px-0.5 text-caption text-fg-secondary">{label}</span>
    </button>
  );
}

function Sidebar() {
  const { t, prefs } = useOwnerConsole();
  const { save, pending } = useSave();

  const modes = [
    { value: "expanded", label: t.settings.sidebar.expanded },
    { value: "collapsed", label: t.settings.sidebar.collapsed },
    { value: "remember", label: t.settings.sidebar.remember },
  ] as const;

  return (
    <SectionCard title={t.settings.sidebar.title} description={t.settings.sidebar.description}>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t.settings.sidebar.title}>
        {modes.map((mode) => (
          <OptionCard
            key={mode.value}
            role="radio"
            aria-checked={prefs.sidebar_mode === mode.value}
            selected={prefs.sidebar_mode === mode.value}
            onClick={() => !pending && save({ sidebar_mode: mode.value })}
          >
            <PanelLeft className="size-5 text-primary" aria-hidden />
            {mode.label}
          </OptionCard>
        ))}
      </div>
    </SectionCard>
  );
}

const alertKeys = ["newLearner", "paymentFailure", "subscription", "aiFailure", "systemError", "critical"] as const;

function Alerts() {
  const { t, prefs } = useOwnerConsole();
  const { save, pending } = useSave();
  const current = prefs.notifications ?? {};

  return (
    <SectionCard title={t.settings.notifications.title} description={t.settings.notifications.description}>
      <ul className="grid gap-5">
        {alertKeys.map((key) => (
          <li key={key} className="flex items-center justify-between gap-4">
            <Label htmlFor={`alert-${key}`}>{t.settings.notifications[key]}</Label>
            <Switch
              id={`alert-${key}`}
              checked={current[key] ?? false}
              disabled={pending}
              onCheckedChange={(checked) => save({ notifications: { ...current, [key]: checked } })}
            />
          </li>
        ))}
      </ul>
      {/* Said plainly rather than implied by a disabled control: these save, and nothing
          sends them yet. */}
      <p className="mt-5 border-t pt-4 text-caption text-fg-muted">{t.settings.notifications.prepared}</p>
    </SectionCard>
  );
}

function Security() {
  const { t, formatDateTime } = useOwnerConsole();
  const signIns = useOwnerSignIns();

  return (
    <div className="grid gap-4">
      <SectionCard title={t.settings.security.title} description={t.settings.security.description}>
        <div className="grid gap-4">
          <Row
            label={t.settings.security.changePassword}
            hint={t.settings.security.changePasswordHint}
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/forgot-password">
                  <KeyRound aria-hidden />
                  {t.settings.security.changePassword}
                </Link>
              </Button>
            }
          />
          <Row
            label={t.settings.security.twoFactor}
            hint={t.settings.security.twoFactorHint}
            action={<Badge variant="outline">{t.settings.security.notAvailable}</Badge>}
          />
        </div>
      </SectionCard>

      <SectionCard title={t.settings.security.signInHistory} description="">
        {signIns.isPending ? (
          <Skeleton className="h-24" />
        ) : (signIns.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-body-sm text-fg-muted">{t.settings.security.noSignIns}</p>
        ) : (
          <ul className="grid gap-2">
            {(signIns.data ?? []).map((entry, index) => (
              <li key={`${entry.created_at}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
                <span className="flex items-center gap-2">
                  <Badge variant={entry.action === "auth.login_failed" ? "destructive" : "outline"}>
                    {entry.action.replace("auth.", "").replace(/_/g, " ")}
                  </Badge>
                  <span className="text-fg-muted">{entry.ip_address || "—"}</span>
                </span>
                <span className="text-caption text-fg-muted tabular-nums">{formatDateTime(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function Sessions() {
  const { t, formatDateTime } = useOwnerConsole();
  const sessions = useOwnerSessions();
  const revoke = useRevokeOwnerSession();
  const revokeOthers = useRevokeOtherOwnerSessions();
  const [confirmAll, setConfirmAll] = useState(false);

  const list = sessions.data ?? [];
  const others = list.filter((s) => !s.current);

  return (
    <SectionCard
      title={t.settings.sessions.title}
      description={t.settings.sessions.description}
      action={
        others.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmAll(true)}>
            {t.settings.sessions.revokeOthers}
          </Button>
        ) : undefined
      }
    >
      {sessions.isError ? (
        <LiveDataState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.isPending ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="grid gap-2">
          {list.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <span className="grid min-w-0 gap-0.5">
                <span className="flex items-center gap-2 text-body-sm">
                  {entry.platform}
                  {entry.current && <Badge variant="success">{t.settings.sessions.current}</Badge>}
                </span>
                <span className="truncate text-caption text-fg-muted">
                  {entry.ip_address || "—"} · {t.settings.sessions.lastUsed} {formatDateTime(entry.created_at)}
                </span>
              </span>
              {!entry.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revoke.isPending}
                  onClick={() => revoke.mutate(entry.id)}
                >
                  {t.settings.sessions.revoke}
                </Button>
              )}
            </li>
          ))}
          {others.length === 0 && (
            <li className="py-2 text-caption text-fg-muted">{t.settings.sessions.none}</li>
          )}
        </ul>
      )}

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t.settings.sessions.revokeOthers}
        description={t.settings.sessions.revokeOthersHint}
        confirmLabel={t.settings.sessions.revokeOthers}
        loading={revokeOthers.isPending}
        onConfirm={() => {
          revokeOthers.mutate();
          setConfirmAll(false);
        }}
      />
    </SectionCard>
  );
}

function AccessibilitySection() {
  const { t, prefs } = useOwnerConsole();
  const { save, pending } = useSave();
  const current = (prefs.accessibility ?? {}) as Record<string, unknown>;

  const toggles = [
    { key: "reduced_motion", label: t.settings.accessibility.reducedMotion, hint: t.settings.accessibility.reducedMotionHint },
    { key: "larger_text", label: t.settings.accessibility.largerText, hint: "" },
    { key: "high_contrast", label: t.settings.accessibility.highContrast, hint: "" },
  ];

  return (
    <SectionCard title={t.settings.accessibility.title} description={t.settings.accessibility.description}>
      <ul className="grid gap-5">
        {toggles.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4">
            <Label htmlFor={`a11y-${item.key}`} className="grid gap-1">
              <span>{item.label}</span>
              {item.hint && <span className="text-caption font-normal text-fg-muted">{item.hint}</span>}
            </Label>
            <Switch
              id={`a11y-${item.key}`}
              checked={current[item.key] === true}
              disabled={pending}
              onCheckedChange={(checked) => save({ accessibility: { ...current, [item.key]: checked } })}
            />
          </li>
        ))}
      </ul>

      <div className="mt-5 grid max-w-xs gap-1.5 border-t pt-4">
        <Label htmlFor="a11y-density">{t.settings.accessibility.density}</Label>
        <NativeSelect
          id="a11y-density"
          value={typeof current.density === "string" ? current.density : "comfortable"}
          disabled={pending}
          onChange={(e) => save({ accessibility: { ...current, density: e.target.value } })}
        >
          <option value="comfortable">{t.settings.accessibility.comfortable}</option>
          <option value="compact">{t.settings.accessibility.compact}</option>
        </NativeSelect>
      </div>
    </SectionCard>
  );
}

function Row({ label, hint, action }: { label: string; hint: string; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <span className="grid min-w-0 gap-0.5">
        <span className="text-body-sm">{label}</span>
        {hint && <span className="text-caption text-fg-muted">{hint}</span>}
      </span>
      {action}
    </div>
  );
}
