"use client";

import { useEffect, useRef } from "react";

import { measureWallpaperTone, useSaveWallpaper, useWallpaper } from "../wallpaper";

/**
 * The learner's background. It fills the main learning area only — never the header or the
 * sidebar — and stays put while the page scrolls.
 *
 * A photo is treated by its own tone rather than by the theme: a dark photo keeps the deep,
 * saturated reading it has in dark mode even when the app is light (washing it towards white is
 * what made it look faded), and the text over it goes light — see [data-wallpaper-tone] in
 * theme.css. A light photo gets the opposite pairing. The presets are translucent colour washes
 * already and need none of this.
 */
export function WallpaperLayer() {
  const { image, selection, tone, photoUrl } = useWallpaper();
  const { saveTone } = useSaveWallpaper();
  const measured = useRef(false);

  // Backgrounds set before the tone was measured (or from another client) get measured once.
  useEffect(() => {
    if (selection !== "custom" || tone || measured.current || !photoUrl) return;
    measured.current = true;
    void measureWallpaperTone(photoUrl).then(saveTone);
  }, [selection, tone, photoUrl, saveTone]);

  if (!image) return null;

  if (selection !== "custom") {
    return (
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <span className="absolute inset-0 bg-cover bg-fixed bg-center" style={{ backgroundImage: image }} />
      </span>
    );
  }

  const darkPhoto = (tone ?? "dark") === "dark";

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <span
        // Oversized so the blur's soft edge is cropped away instead of showing as a rim.
        className={
          darkPhoto
            ? "absolute -inset-4 bg-cover bg-fixed bg-center [filter:brightness(0.7)_saturate(1.1)_blur(2px)]"
            : "absolute -inset-4 bg-cover bg-fixed bg-center [filter:brightness(1.04)_saturate(1)_blur(2px)]"
        }
        style={{ backgroundImage: image }}
      />
      {/* A scrim in the photo's own direction — dark over a dark photo, light over a light one —
          so it settles the picture without draining its colour. The value lives with the tone. */}
      <span className="absolute inset-0 bg-(--photo-scrim)" />
    </span>
  );
}
