"use client";

import type { Profile } from "@engora/types";

import { apiAssetUrl } from "@/lib/media";

import { useProfile, useUpdateProfile } from "./hooks";

/**
 * The learner's background for the app's main area. The choice is saved on the profile, so
 * it follows them to other devices; the image itself lives in object storage like avatars.
 *
 * Every preset's CSS is defined here, never sent by the server, and an uploaded background
 * is only ever rendered from a path the API itself issued (see `wallpaperImage`).
 */

export const wallpaperPresets = [
  {
    id: "aurora",
    label: "Aurora",
    image:
      "radial-gradient(60% 50% at 12% 8%, oklch(69.6% 0.17 162.48 / 0.42), transparent 70%), radial-gradient(52% 46% at 88% 18%, oklch(0.72 0.13 225 / 0.34), transparent 70%), radial-gradient(64% 56% at 50% 96%, oklch(0.78 0.11 150 / 0.26), transparent 70%)",
  },
  {
    id: "dusk",
    label: "Dusk",
    image:
      "radial-gradient(58% 48% at 82% 10%, oklch(0.62 0.18 300 / 0.38), transparent 70%), radial-gradient(54% 48% at 12% 26%, oklch(0.66 0.16 265 / 0.32), transparent 70%), radial-gradient(70% 55% at 50% 98%, oklch(0.7 0.13 330 / 0.24), transparent 70%)",
  },
  {
    id: "sunrise",
    label: "Sunrise",
    image:
      "radial-gradient(58% 50% at 14% 12%, oklch(0.82 0.15 70 / 0.38), transparent 70%), radial-gradient(52% 46% at 86% 22%, oklch(0.75 0.16 25 / 0.28), transparent 70%), radial-gradient(66% 54% at 55% 96%, oklch(0.85 0.12 95 / 0.24), transparent 70%)",
  },
  {
    id: "ocean",
    label: "Ocean",
    image:
      "radial-gradient(60% 52% at 16% 14%, oklch(0.66 0.14 245 / 0.4), transparent 70%), radial-gradient(54% 46% at 84% 12%, oklch(0.74 0.12 200 / 0.3), transparent 70%), radial-gradient(66% 56% at 48% 96%, oklch(0.7 0.11 220 / 0.26), transparent 70%)",
  },
  {
    id: "mist",
    label: "Mist",
    image:
      "radial-gradient(70% 60% at 20% 10%, oklch(0.75 0.03 165 / 0.35), transparent 72%), radial-gradient(60% 50% at 85% 25%, oklch(0.7 0.02 240 / 0.28), transparent 72%), radial-gradient(75% 60% at 50% 100%, oklch(0.8 0.02 140 / 0.22), transparent 72%)",
  },
] as const;

export type PresetId = (typeof wallpaperPresets)[number]["id"];
export type WallpaperId = PresetId | "custom" | "none";

/** Only paths the API issued become CSS, so a tampered preference cannot inject anything. */
const assetPath = /^\/api\/v1\/wallpapers\/[A-Za-z0-9/_.-]+$/;

export function wallpaperSelection(profile: Profile | undefined): WallpaperId {
  const saved = profile?.preferences?.wallpaper;
  if (typeof saved !== "string") return "none";
  if (saved === "custom") return profile?.wallpaper_url ? "custom" : "none";
  return wallpaperPresets.some((p) => p.id === saved) ? (saved as PresetId) : "none";
}

/** The `background-image` value for the learner's choice, or null when they have none. */
export function wallpaperImage(profile: Profile | undefined): string | null {
  const selection = wallpaperSelection(profile);
  if (selection === "none") return null;
  if (selection === "custom") {
    const path = profile?.wallpaper_url;
    if (!path || !assetPath.test(path)) return null;
    const url = apiAssetUrl(path);
    return url ? `url("${url}")` : null;
  }
  return wallpaperPresets.find((p) => p.id === selection)?.image ?? null;
}

export function useWallpaper() {
  const { data: profile } = useProfile();
  return { image: wallpaperImage(profile), selection: wallpaperSelection(profile) };
}

export function useSaveWallpaper() {
  const update = useUpdateProfile();
  return {
    save: (id: WallpaperId) => update.mutate({ preferences: { wallpaper: id } }),
    saveAsync: (id: WallpaperId) => update.mutateAsync({ preferences: { wallpaper: id } }),
    isSaving: update.isPending,
  };
}
