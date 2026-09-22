"use client";

import type { Profile } from "@engora/types";

import { apiAssetUrl } from "@/lib/media";
import { isAnimatedPreset, wallpaperPresets, type PresetId, type WallpaperPreset } from "@/lib/wallpapers";

import { useProfile, useUpdateProfile } from "./hooks";

/**
 * The learner's background for the app's main area. The choice is saved on the profile, so it
 * follows them to other devices; the image itself lives in object storage like avatars.
 *
 * Every preset's CSS is defined here, never sent by the server, and an uploaded background is
 * only ever rendered from a path the API itself issued (see `wallpaperImage`).
 */

// Re-exported so existing imports keep working; the set itself lives in @/lib/wallpapers.
export { wallpaperPresets, isAnimatedPreset, presetById, type PresetId, type WallpaperPreset } from "@/lib/wallpapers";

/** The preset behind a selection, if the learner picked one of the built-ins. */
export function wallpaperPreset(profile: Profile | undefined): WallpaperPreset | null {
  const selection = wallpaperSelection(profile);
  return wallpaperPresets.find((preset) => preset.id === selection) ?? null;
}
export type WallpaperId = PresetId | "custom" | "none";

/** Whether the photo itself is dark or light. Text over it follows this, not the theme. */
export type WallpaperTone = "dark" | "light";

/** Only paths the API issued become CSS, so a tampered preference cannot inject anything. */
const assetPath = /^\/api\/v1\/wallpapers\/[A-Za-z0-9/_.-]+$/;

export function wallpaperSelection(profile: Profile | undefined): WallpaperId {
  const saved = profile?.preferences?.wallpaper;
  if (typeof saved !== "string") return "none";
  if (saved === "custom") return profile?.wallpaper_url ? "custom" : "none";
  // The forest preset became the animated aurora; anyone already on it moves across with it.
  if (saved === "forest") return "aurora-live";
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
 * from a File while uploading, or from the stored photo's URL.
 *
 * Returns null when the image cannot be read, rather than guessing: a guess would be saved as
 * if it were measured, and the caller can retry from the other source instead.
 */
export async function measureWallpaperTone(source: File | string): Promise<WallpaperTone | null> {
  try {
    // Decoded through createImageBitmap rather than <img>: the CSS background has already
    // cached this URL as a no-CORS response, and asking <img crossorigin> for the same entry
    // fails to decode. A reloading CORS fetch gets its own, readable copy.
    const blob = typeof source === "string" ? await (await fetch(source, { mode: "cors", cache: "reload" })).blob() : source;
    const bitmap = await createImageBitmap(blob);

    const width = 48;
    const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const { data } = context.getImageData(0, 0, width, height);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      total += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    return total / (data.length / 4) < 0.5 ? "dark" : "light";
  } catch {
    return null;
  }
}

export function useWallpaper() {
  const { data: profile } = useProfile();
  const preset = wallpaperPreset(profile);
  return {
    image: wallpaperImage(profile),
    selection: wallpaperSelection(profile),
    // The animated aurora is a night scene, so text over it reads the way it does over a dark
    // photo: light, with a dark halo.
    // A plain colour wash has no tone of its own; it must not inherit the last photo's.
    tone: isAnimatedPreset(preset)
      ? ("dark" as WallpaperTone)
      : wallpaperSelection(profile) === "custom"
        ? wallpaperTone(profile)
        : null,
    photoUrl: wallpaperPhotoUrl(profile),
    preset,
  };
}

export function useSaveWallpaper() {
  const update = useUpdateProfile();
  // `undefined` leaves the stored tone alone; `null` clears it, so a new photo never inherits
  // the previous one's reading. Anything cleared is measured again by the layer.
  const preferences = (id: WallpaperId, tone?: WallpaperTone | null) =>
    tone === undefined ? { wallpaper: id } : { wallpaper: id, wallpaper_tone: tone };
  return {
    save: (id: WallpaperId, tone?: WallpaperTone | null) => update.mutate({ preferences: preferences(id, tone) }),
    saveAsync: (id: WallpaperId, tone?: WallpaperTone | null) => update.mutateAsync({ preferences: preferences(id, tone) }),
    saveTone: (tone: WallpaperTone) => update.mutate({ preferences: { wallpaper_tone: tone } }),
    isSaving: update.isPending,
  };
}
