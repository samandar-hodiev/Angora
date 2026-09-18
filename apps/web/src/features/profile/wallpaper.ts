"use client";

import type { Profile } from "@engora/types";

import { apiAssetUrl } from "@/lib/media";

import { useProfile, useUpdateProfile } from "./hooks";

/**
 * The learner's background for the app's main area. The choice is saved on the profile, so it
 * follows them to other devices; the image itself lives in object storage like avatars.
 *
 * Every preset's CSS is defined here, never sent by the server, and an uploaded background is
 * only ever rendered from a path the API itself issued (see `wallpaperImage`).
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
  {
    id: "forest",
    label: "Forest",
    image:
      "radial-gradient(62% 52% at 18% 12%, oklch(0.55 0.13 152 / 0.44), transparent 70%), radial-gradient(56% 48% at 84% 24%, oklch(0.62 0.1 175 / 0.32), transparent 70%), radial-gradient(70% 58% at 46% 98%, oklch(0.48 0.1 145 / 0.3), transparent 72%)",
  },
  {
    id: "blossom",
    label: "Blossom",
    image:
      "radial-gradient(58% 50% at 16% 10%, oklch(0.78 0.14 355 / 0.38), transparent 70%), radial-gradient(54% 46% at 86% 20%, oklch(0.8 0.1 20 / 0.3), transparent 70%), radial-gradient(68% 56% at 52% 96%, oklch(0.84 0.08 340 / 0.26), transparent 72%)",
  },
  {
    id: "ember",
    label: "Ember",
    image:
      "radial-gradient(60% 52% at 14% 14%, oklch(0.66 0.17 40 / 0.4), transparent 70%), radial-gradient(54% 46% at 88% 18%, oklch(0.6 0.19 18 / 0.32), transparent 70%), radial-gradient(70% 58% at 48% 98%, oklch(0.72 0.14 62 / 0.26), transparent 72%)",
  },
  {
    id: "lavender",
    label: "Lavender",
    image:
      "radial-gradient(60% 50% at 20% 10%, oklch(0.72 0.12 290 / 0.4), transparent 70%), radial-gradient(54% 48% at 85% 22%, oklch(0.76 0.09 265 / 0.3), transparent 70%), radial-gradient(70% 58% at 50% 98%, oklch(0.8 0.07 310 / 0.24), transparent 72%)",
  },
  {
    id: "sand",
    label: "Sand",
    image:
      "radial-gradient(64% 54% at 18% 12%, oklch(0.82 0.07 80 / 0.4), transparent 72%), radial-gradient(56% 48% at 86% 24%, oklch(0.78 0.06 55 / 0.3), transparent 72%), radial-gradient(72% 58% at 48% 98%, oklch(0.86 0.05 95 / 0.24), transparent 72%)",
  },
] as const;

export type PresetId = (typeof wallpaperPresets)[number]["id"];
export type WallpaperId = PresetId | "custom" | "none";

/** Whether the photo itself is dark or light. Text over it follows this, not the theme. */
export type WallpaperTone = "dark" | "light";

/** Only paths the API issued become CSS, so a tampered preference cannot inject anything. */
const assetPath = /^\/api\/v1\/wallpapers\/[A-Za-z0-9/_.-]+$/;

export function wallpaperSelection(profile: Profile | undefined): WallpaperId {
  const saved = profile?.preferences?.wallpaper;
  if (typeof saved !== "string") return "none";
  if (saved === "custom") return profile?.wallpaper_url ? "custom" : "none";
  return wallpaperPresets.some((p) => p.id === saved) ? (saved as PresetId) : "none";
}

/** The learner's uploaded photo as an absolute URL, or null. */
export function wallpaperPhotoUrl(profile: Profile | undefined): string | null {
  const path = profile?.wallpaper_url;
  if (!path || !assetPath.test(path)) return null;
  return apiAssetUrl(path);
}

export function wallpaperTone(profile: Profile | undefined): WallpaperTone | null {
  const saved = profile?.preferences?.wallpaper_tone;
  return saved === "dark" || saved === "light" ? saved : null;
}

/** The `background-image` value for the learner's choice, or null when they have none. */
export function wallpaperImage(profile: Profile | undefined): string | null {
  const selection = wallpaperSelection(profile);
  if (selection === "none") return null;
  if (selection === "custom") {
    const url = wallpaperPhotoUrl(profile);
    return url ? `url("${url}")` : null;
  }
  return wallpaperPresets.find((p) => p.id === selection)?.image ?? null;
}

/**
 * Mean luminance of the image, which decides whether text over it goes light or dark. Measured
 * from a File while uploading, or from the stored photo's URL for backgrounds set before this
 * existed. Falls back to "dark": most photos are, and the layer defaults the same way.
 */
export async function measureWallpaperTone(source: File | string): Promise<WallpaperTone> {
  const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source);
  try {
    const image = new Image();
    if (typeof source === "string") image.crossOrigin = "anonymous";
    image.src = objectUrl ?? (source as string);
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "dark";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      total += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    return total / (data.length / 4) < 0.5 ? "dark" : "light";
  } catch {
    return "dark";
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function useWallpaper() {
  const { data: profile } = useProfile();
  return {
    image: wallpaperImage(profile),
    selection: wallpaperSelection(profile),
    tone: wallpaperTone(profile),
    photoUrl: wallpaperPhotoUrl(profile),
  };
}

export function useSaveWallpaper() {
  const update = useUpdateProfile();
  const preferences = (id: WallpaperId, tone?: WallpaperTone) => (tone ? { wallpaper: id, wallpaper_tone: tone } : { wallpaper: id });
  return {
    save: (id: WallpaperId, tone?: WallpaperTone) => update.mutate({ preferences: preferences(id, tone) }),
    saveAsync: (id: WallpaperId, tone?: WallpaperTone) => update.mutateAsync({ preferences: preferences(id, tone) }),
    saveTone: (tone: WallpaperTone) => update.mutate({ preferences: { wallpaper_tone: tone } }),
    isSaving: update.isPending,
  };
}
