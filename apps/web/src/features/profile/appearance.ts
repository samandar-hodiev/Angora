"use client";

import { useCallback, useEffect, useRef } from "react";

import { isThemePreference, type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/providers/theme-provider";

import { useProfile, useUpdateProfile } from "./hooks";

/** Applies the appearance saved on the learner's profile (set on another device). */
export function useSyncAppearance() {
  const { data: profile } = useProfile();
  const { preference, setPreference } = useTheme();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current || !profile) return;
    synced.current = true;
    const saved = profile.preferences?.appearance;
    if (isThemePreference(saved) && saved !== preference) setPreference(saved);
  }, [profile, preference, setPreference]);
}

/** Changes appearance locally and saves it to the profile so it follows the learner. */
export function useSaveAppearance() {
  const { setPreference } = useTheme();
  const update = useUpdateProfile();
  const { mutate } = update;
  const save = useCallback(
    (next: ThemePreference) => {
      setPreference(next);
      mutate({ preferences: { appearance: next } });
    },
    [mutate, setPreference],
  );
  return { save, isSaving: update.isPending };
}
