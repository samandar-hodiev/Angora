"use client";

import { useWallpaper } from "../wallpaper";

/**
 * The learner's background. It fills the main learning area only — never the header or the
 * sidebar — and stays put while the page scrolls.
 *
 * A photo has to sit behind text in both themes. Veiling it until the faintest label passed on
 * its own turned out to need almost the whole picture away (measured: a flat light veil had to
 * reach 0.96), so the photo stays visible and the text is protected instead — see the halo and
 * the stepped-up text tokens under [data-wallpaper="photo"] in theme.css. Here the photo is
 * only nudged towards the theme: softened and slightly lifted in light mode, dimmed in dark.
 * The presets are translucent colour washes already and need none of this.
 */
export function WallpaperLayer() {
  const { image, selection } = useWallpaper();
  if (!image) return null;
  const isPhoto = selection === "custom";

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <span
        className={
          isPhoto
            ? // Oversized so the blur's soft edge is cropped away instead of showing as a rim.
              "absolute -inset-4 bg-cover bg-fixed bg-center [filter:brightness(1.05)_saturate(1.15)_blur(3px)] dark:[filter:brightness(0.65)_saturate(1.05)_blur(2px)]"
            : "absolute inset-0 bg-cover bg-fixed bg-center"
        }
        style={{ backgroundImage: image }}
      />
      {/* Only enough veil to keep the picture calm behind content. The text's own halo does the
          readability work, so this stays light and the photo keeps its colour. */}
      {isPhoto && (
        <span className="absolute inset-0 bg-surface/55 dark:bg-background/45" />
      )}
    </span>
  );
}
