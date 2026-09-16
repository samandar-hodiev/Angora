"use client";

import { useWallpaper } from "../wallpaper";

/**
 * The learner's background. It fills the main learning area only — never the header or the
 * sidebar — and stays put while the page scrolls. Uploaded photos get a scrim so text and
 * cards keep their contrast; the presets are translucent washes and need none.
 */
export function WallpaperLayer() {
  const { image, selection } = useWallpaper();
  if (!image) return null;

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <span className="absolute inset-0 bg-cover bg-fixed bg-center" style={{ backgroundImage: image }} />
      {selection === "custom" && <span className="absolute inset-0 bg-background/70" />}
    </span>
  );
}
