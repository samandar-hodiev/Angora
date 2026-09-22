/**
 * The built-in backgrounds, shared by the learner app and the Owner Console.
 *
 * They are CSS, not images: no request, no storage, no cache, and they re-colour themselves
 * with the theme. Defined in one place because both surfaces offer the same set, and two
 * copies of eleven gradients would drift apart the first time a designer touched one.
 *
 * Nothing here comes from the server. A stored selection is only ever an id that is matched
 * against this list, so an unknown or tampered value renders nothing rather than injecting
 * anything.
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
    // The one preset that moves: a northern-lights curtain drifting behind the content. The
    // still gradient below is what a reduced-motion setting (and the swatch) falls back to.
    id: "aurora-live",
    label: "Aurora live",
    animated: true,
    // A full night sky rather than a translucent wash, because the ribbon above it only reads
    // against something dark. Text over it is handled like a dark photo (see useWallpaper).
    image:
      "linear-gradient(168deg, oklch(0.19 0.06 258) 0%, oklch(0.23 0.07 236) 38%, oklch(0.29 0.08 205) 66%, oklch(0.2 0.05 248) 100%)",
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
  {
    id: "prism",
    label: "Prism",
    image:
      "radial-gradient(58% 50% at 12% 10%, oklch(0.62 0.24 27 / 0.48), transparent 70%), radial-gradient(56% 48% at 88% 18%, oklch(0.6 0.22 264 / 0.42), transparent 70%), radial-gradient(66% 56% at 50% 98%, oklch(0.72 0.2 145 / 0.38), transparent 72%)",
  },
] as const;

export type PresetId = (typeof wallpaperPresets)[number]["id"];
export type WallpaperPreset = (typeof wallpaperPresets)[number];

/** Only one preset moves, so the flag is optional across the set. */
export function isAnimatedPreset(preset: WallpaperPreset | null): boolean {
  return !!preset && "animated" in preset && preset.animated === true;
}

/** The preset with this id, or null. An unknown id — old, renamed, tampered — is simply no
 *  background, which is the safe outcome for a value that becomes CSS. */
export function presetById(id: string | null | undefined): WallpaperPreset | null {
  return wallpaperPresets.find((preset) => preset.id === id) ?? null;
}
