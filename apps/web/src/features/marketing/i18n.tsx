"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { en, type Messages } from "@/locales/en";
import { ru } from "@/locales/ru";
import { uz } from "@/locales/uz";

export const LOCALES = [
  { code: "en", label: "English", short: "EN" },
  { code: "uz", label: "O‘zbek", short: "UZ" },
  { code: "ru", label: "Русский", short: "RU" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

const messages: Record<Locale, Messages> = { en, uz, ru };
const STORAGE_KEY = "engora-locale";
const CHANGE_EVENT = "engora-locale-change";
const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "uz" || value === "ru";
}

function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Frontend-only translations for the public website. English is rendered on the server
 * (SEO); a stored choice is applied on the client and persisted in localStorage.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => DEFAULT_LOCALE);

  useEffect(() => {
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.lang = DEFAULT_LOCALE;
    };
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable: nothing to persist.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(() => ({ locale, setLocale, t: messages[locale] }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
