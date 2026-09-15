"use client";

import { Check, ChevronDown, Globe, Moon, Sun } from "lucide-react";

import { IconButton } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { useTheme } from "@/providers/theme-provider";

import { isLocale, LOCALES, useI18n } from "../i18n";

export function LanguageSelector({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t.nav.language}: ${current.label}`}
        className={cn(
          "glass-button inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-label text-foreground outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
          className,
        )}
      >
        <Globe className="size-4 text-fg-muted" aria-hidden />
        {current.short}
        <ChevronDown className="size-3.5 text-fg-muted" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass w-44 bg-transparent">
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => isLocale(v) && setLocale(v)}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l.code} value={l.code} className="data-[state=checked]:text-primary-subtle-foreground">
              <span className="w-6 text-caption text-fg-muted">{l.short}</span>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Segmented language choice for the mobile menu. */
export function LanguageOptions() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t.nav.language} className="grid grid-cols-3 gap-2">
      {LOCALES.map((l) => (
        <button
          key={l.code}
          role="radio"
          aria-checked={locale === l.code}
          onClick={() => setLocale(l.code)}
          className={cn(
            "glass-button flex h-10 items-center justify-center gap-1.5 rounded-md text-body-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            locale === l.code && "border-primary/40 text-primary-subtle-foreground",
          )}
        >
          {locale === l.code && <Check className="size-3.5" aria-hidden />}
          {l.label}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  const { t } = useI18n();
  const dark = resolved === "dark";

  return (
    <IconButton
      label={dark ? t.nav.switchToLight : t.nav.switchToDark}
      variant="glass"
      size="icon-sm"
      className={cn("size-9", className)}
      onClick={() => setPreference(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}

/** Explicit light/dark choice for the mobile menu. */
export function ThemeOptions() {
  const { resolved, setPreference } = useTheme();
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t.nav.theme} className="grid grid-cols-2 gap-2">
      {(
        [
          ["dark", t.nav.dark, Moon],
          ["light", t.nav.light, Sun],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          role="radio"
          aria-checked={resolved === value}
          onClick={() => setPreference(value)}
          className={cn(
            "glass-button flex h-10 items-center justify-center gap-2 rounded-md text-body-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            resolved === value && "border-primary/40 text-primary-subtle-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
