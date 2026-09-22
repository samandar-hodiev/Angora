"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { ownerEn, type OwnerMessages } from "./locales/en";
import { ownerRu } from "./locales/ru";
import { ownerUz } from "./locales/uz";
import { useOwnerPreferences } from "./hooks";
import type { OwnerLocale, OwnerPreferences } from "./types";

/**
 * The Owner Console's own preferences, applied.
 *
 * Every value here belongs to the operator, comes from owner_preferences, and reaches
 * nothing outside this console. The learner app has its own theme, its own language and its
 * own wallpaper, stored elsewhere and read by other code — the two cannot see each other,
 * which is the point.
 *
 * While the request is in flight the defaults stand: Uzbek and dark. That matters more than
 * it sounds. A console that renders in English and then snaps to Uzbek a moment later looks
 * broken every single time it loads.
 */

const dictionaries: Record<OwnerLocale, OwnerMessages> = { en: ownerEn, uz: ownerUz, ru: ownerRu };

function colorSchemeQuery(): MediaQueryList | null {
  return typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
}

function subscribeToColorScheme(onChange: () => void) {
  const media = colorSchemeQuery();
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

function readSystemDark(): boolean {
  return colorSchemeQuery()?.matches ?? true;
}

export const ownerLocales: { code: OwnerLocale; label: string }[] = [
  { code: "uz", label: "O‘zbekcha" },
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
];

export const defaultOwnerPreferences: OwnerPreferences = {
  locale: "uz",
  theme: "dark",
  timezone: "Asia/Tashkent",
  date_format: "dmy",
  time_format: "24h",
  sidebar_mode: "remember",
  wallpaper: { url: null, enabled: false, overlay: 70 },
  notifications: {},
  accessibility: {},
  updated_at: null,
};

interface OwnerConsole {
  prefs: OwnerPreferences;
  /** True until the operator's own preferences have arrived; the defaults are in use. */
  loading: boolean;
  t: OwnerMessages;
  /** "dark" or "light" — "system" already resolved. */
  resolvedTheme: "dark" | "light";
  formatDate: (iso: string) => string;
  formatDateTime: (iso: string) => string;
}

const OwnerConsoleContext = createContext<OwnerConsole | null>(null);

export function OwnerPreferencesProvider({ children }: { children: ReactNode }) {
  const query = useOwnerPreferences();
  const prefs = query.data ?? defaultOwnerPreferences;

  // Only consulted when the operator chose "match my system". Read through an external
  // store so the server render and the first client render agree on dark — the console's
  // default — instead of flashing light for a frame.
  const systemDark = useSyncExternalStore(subscribeToColorScheme, readSystemDark, () => true);

  const value = useMemo<OwnerConsole>(() => {
    const resolvedTheme = prefs.theme === "system" ? (systemDark ? "dark" : "light") : prefs.theme;

    // A time zone the browser cannot load would throw on every date the console renders,
    // so an unusable one falls back rather than taking the page down.
    const zone = safeTimeZone(prefs.timezone);
    const locale = intlLocale(prefs.date_format, prefs.locale);
    const hour12 = prefs.time_format === "12h";

    const date = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const dateTime = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12,
    });

    return {
      prefs,
      loading: query.isPending,
      t: dictionaries[prefs.locale] ?? ownerEn,
      resolvedTheme,
      formatDate: (iso) => safeFormat(date, iso),
      formatDateTime: (iso) => safeFormat(dateTime, iso),
    };
  }, [prefs, systemDark, query.isPending]);

  return <OwnerConsoleContext.Provider value={value}>{children}</OwnerConsoleContext.Provider>;
}

/**
 * Usable outside the provider on purpose: a few console pieces render before it (the guard,
 * the loading state), and they should show the defaults rather than throw.
 */
export function useOwnerConsole(): OwnerConsole {
  const context = useContext(OwnerConsoleContext);
  if (context) return context;
  return {
    prefs: defaultOwnerPreferences,
    loading: true,
    t: ownerUz,
    resolvedTheme: "dark",
    formatDate: (iso) => iso,
    formatDateTime: (iso) => iso,
  };
}

/** Shorthand for the common case: just the words. */
export function useOwnerText(): OwnerMessages {
  return useOwnerConsole().t;
}

/**
 * The formatting locale is chosen by the date format, not by the language: an operator
 * reading the console in Uzbek may still want ISO dates in a table they paste into a
 * spreadsheet, and "dd.MM.yyyy" is not a property of the Uzbek language.
 */
function intlLocale(format: OwnerPreferences["date_format"], locale: OwnerLocale): string {
  if (format === "iso") return "en-CA";
  if (format === "mdy") return "en-US";
  return locale === "ru" ? "ru-RU" : "en-GB";
}

function safeTimeZone(zone: string): string | undefined {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

function safeFormat(formatter: Intl.DateTimeFormat, iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : formatter.format(parsed);
}
