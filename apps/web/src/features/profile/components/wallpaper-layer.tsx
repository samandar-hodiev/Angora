"use client";

import { useWallpaper } from "../wallpaper";

/**
 * The learner's background. It fills the main learning area only — never the header or the
 * sidebar — and stays put while the page scrolls.
 *
 * A photo has to sit behind text in both themes, so instead of hiding it under a thick veil
 * the photo itself is pulled towards the theme: brightened in light mode, dimmed in dark.
 * That keeps the picture legible as a picture while headings and cards keep their contrast.
 * The presets are translucent colour washes already and need neither treatment.
 */
export function WallpaperLayer() {
  const { image, selection } = useWallpaper();
  if (!image) return null;
  const isPhoto = selection === "custom";

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <span
        className={
          isPhoto
            ? // Oversized so the blur's soft edge is cropped away instead of showing as a rim.
              "absolute -inset-4 bg-cover bg-fixed bg-center [filter:brightness(1.2)_saturate(0.9)_blur(2px)] dark:[filter:brightness(0.6)_saturate(0.95)]"
            : "absolute inset-0 bg-cover bg-fixed bg-center"
        }
        style={{ backgroundImage: image }}
      />
      {/* The veil sets a luminance floor for whatever photo is uploaded, so the faintest text
          sitting straight on it still clears 4.5:1. Light mode needs more of it: its muted text
          is close to the page colour, while dark mode's text is far from its near-black base. */}
      {/* Light mode veils towards the card surface (white) rather than the page colour: the
          faintest text is measured against white, so the same amount of veil buys more
          contrast and the photo keeps more of itself. */}
      {isPhoto && <span className="absolute inset-0 bg-surface/84 dark:bg-background/55" />}
    </span>
  );
}
