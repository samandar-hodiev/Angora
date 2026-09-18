"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { measureWallpaperTone, useSaveWallpaper, useWallpaper } from "../wallpaper";

/** The learning area, in the shell's own terms: below the header, right of the sidebar. */
const frame = "pointer-events-none fixed top-14 right-0 bottom-0 left-0 -z-10 md:left-62";

/**
 * The learner's background. It fills the main learning area only — never the header or the
 * sidebar — and stays put while the page scrolls.
 *
 * The layer is genuinely fixed to the viewport, inset to the shell's own measurements (the
 * 3.5rem header, the 15.5rem sidebar from md up) so it still covers the learning area only. Two
 * simpler routes do not hold: `background-attachment: fixed` is downgraded to scroll by the
 * filter on the element — `cover` then fits the whole scroll height and blows the picture up —
 * and a sticky layer still drifts by the header's height at the top of the page.
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
    void measureWallpaperTone(photoUrl).then((measured) => {
      if (measured) saveTone(measured);
    });
  }, [selection, tone, photoUrl, saveTone]);

  if (!image) return null;

  if (selection !== "custom") {
    return (
      <span aria-hidden className={cn(frame, "bg-cover bg-center")} style={{ backgroundImage: image }} />
    );
  }

  const darkPhoto = (tone ?? "dark") === "dark";

  return (
    <span aria-hidden className={cn(frame, "overflow-clip")}>
      <span
        className={cn(
          "absolute inset-0 bg-cover bg-center",
          darkPhoto ? "[filter:brightness(0.7)_saturate(1.1)_blur(1px)]" : "[filter:brightness(1.02)_saturate(1.05)_blur(1px)]",
        )}
        style={{ backgroundImage: image }}
      />
      {/* A scrim in the photo's own direction — dark over a dark photo, light over a light one —
          so it settles the picture without draining its colour. The value lives with the tone. */}
      <span className="absolute inset-0 bg-(--photo-scrim)" />
    </span>
  );
}
