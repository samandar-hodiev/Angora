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
 * The app keeps its own reading — dark mode stays dark, light mode stays light — and the photo
 * is pulled towards it instead: a bright picture is dimmed for dark mode, a dark one lifted for
 * light mode. That is what the measured tone is for here; the scrim and the text halo live with
 * the theme in theme.css. The presets are translucent colour washes already and need none of
 * this.
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

  // Each pairing gets its own nudge: the further the photo is from the theme, the more it moves.
  const darkPhoto = (tone ?? "dark") === "dark";
  const photoFilter = darkPhoto
    ? "[filter:brightness(1.3)_saturate(0.95)_blur(1px)] dark:[filter:brightness(0.95)_saturate(1.1)_blur(1px)]"
    : "[filter:brightness(1)_saturate(1.05)_blur(1px)] dark:[filter:brightness(0.82)_saturate(1.12)_blur(1px)]";

  return (
    <span aria-hidden className={cn(frame, "overflow-clip")}>
      <span className={cn("absolute inset-0 bg-cover bg-center", photoFilter)} style={{ backgroundImage: image }} />
      {/* The scrim settles the picture in the theme's direction. A photo that runs against the
          theme — a dark one in light mode, a bright one in dark mode — gets the stronger of the
          two, because that is when text lying on the photo has the least to work with. */}
      <span className={cn("absolute inset-0", darkPhoto ? "bg-(--photo-scrim-clash) dark:bg-(--photo-scrim)" : "bg-(--photo-scrim) dark:bg-(--photo-scrim-clash)")} />
    </span>
  );
}
