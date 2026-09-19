"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { isAnimatedPreset, measureWallpaperTone, useSaveWallpaper, useWallpaper, type WallpaperTone } from "../wallpaper";

/**
 * Northern lights: three soft curtains drifting out of step with each other. Sized in percent so
 * the same markup works behind the whole learning area and inside a preview swatch, and stilled
 * for anyone who asked for less motion.
 */
export function AuroraCurtain() {
  return (
    <span aria-hidden className="absolute inset-0 overflow-clip">
      <span className="absolute -top-1/4 -left-1/5 h-[75%] w-[55%] animate-aurora rounded-full bg-[radial-gradient(closest-side,oklch(0.8_0.18_158_/_0.55),transparent)] blur-2xl motion-reduce:animate-none" />
      <span className="absolute -top-[10%] left-1/3 h-[85%] w-[45%] animate-aurora-slow rounded-full bg-[radial-gradient(closest-side,oklch(0.74_0.14_196_/_0.45),transparent)] blur-2xl motion-reduce:animate-none" />
      <span className="absolute right-0 -bottom-1/5 h-[70%] w-[50%] animate-aurora rounded-full bg-[radial-gradient(closest-side,oklch(0.64_0.17_292_/_0.4),transparent)] blur-2xl [animation-delay:-7s] motion-reduce:animate-none" />
    </span>
  );
}

/** The learning area, in the shell's own terms: below the header, right of the sidebar. */
const frame = "pointer-events-none fixed top-14 right-0 bottom-0 left-0 md:left-62";

/** Everything above this line belongs to the title, not to the scrolling content. */
const maskHeight = "calc(var(--main-pt, 1.5rem) + var(--page-title-h, 3.5rem) + 0.75rem)";

/** Each pairing gets its own nudge: the further the photo is from the theme, the more it moves. */
function photoFilter(tone: WallpaperTone) {
  return tone === "dark"
    ? "[filter:brightness(1.3)_saturate(0.95)_blur(1px)] dark:[filter:brightness(0.95)_saturate(1.1)_blur(1px)]"
    : "[filter:brightness(1)_saturate(1.05)_blur(1px)] dark:[filter:brightness(0.82)_saturate(1.12)_blur(1px)]";
}

function scrim(tone: WallpaperTone) {
  // A photo that runs against the theme — a dark one in light mode, a bright one in dark mode —
  // gets the stronger of the two, because that is when text lying on it has the least to work with.
  return tone === "dark"
    ? "bg-(--photo-scrim-clash) dark:bg-(--photo-scrim)"
    : "bg-(--photo-scrim) dark:bg-(--photo-scrim-clash)";
}

/**
 * The learner's background. It fills the main learning area only — never the header or the
 * sidebar — and is genuinely fixed to the viewport, inset to the shell's own measurements, so it
 * does not move by a pixel while the page scrolls.
 *
 * The app keeps its own reading — dark mode stays dark, light mode stays light — and the photo is
 * pulled towards it instead: a bright picture is dimmed for dark mode, a dark one lifted for
 * light mode. That is what the measured tone is for here; the scrim and the text halo live with
 * the theme in theme.css. The presets are translucent colour washes already and need none of it.
 */
export function WallpaperLayer() {
  const { image, selection, tone, photoUrl, preset } = useWallpaper();
  const { saveTone } = useSaveWallpaper();
  const measured = useRef(false);

  // Backgrounds set before the tone was measured (or from another client) get measured once.
  useEffect(() => {
    if (selection !== "custom" || tone || measured.current || !photoUrl) return;
    measured.current = true;
    void measureWallpaperTone(photoUrl).then((result) => {
      if (result) saveTone(result);
    });
  }, [selection, tone, photoUrl, saveTone]);

  if (!image) return null;

  if (selection !== "custom") {
    return (
      <span aria-hidden className={cn(frame, "-z-10 bg-cover bg-center")} style={{ backgroundImage: image }}>
        {isAnimatedPreset(preset) && <AuroraCurtain />}
      </span>
    );
  }

  return (
    <span aria-hidden className={cn(frame, "-z-10 overflow-clip")}>
      <span className={cn("absolute inset-0 bg-cover bg-center", photoFilter(tone ?? "dark"))} style={{ backgroundImage: image }} />
      <span className={cn("absolute inset-0", scrim(tone ?? "dark"))} />
    </span>
  );
}

/**
 * The same background again, clipped to the band the page title sits in and painted *above* the
 * content. Scrolling cards disappear into it 12px before they would reach the title, while the
 * band itself still shows the wallpaper — it is the identical layer in the identical box, so the
 * two line up exactly. With no wallpaper it is simply the page's own colour.
 */
export function WallpaperMask() {
  const { image, selection, tone, preset } = useWallpaper();
  const clip = { clipPath: `inset(0 0 calc(100% - ${maskHeight}) 0)` };

  if (!image) return <span aria-hidden className={cn(frame, "z-10 bg-background")} style={clip} />;

  if (selection !== "custom") {
    return (
      <span aria-hidden className={cn(frame, "z-10 bg-background")} style={clip}>
        <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: image }} />
        {isAnimatedPreset(preset) && <AuroraCurtain />}
      </span>
    );
  }

  return (
    <span aria-hidden className={cn(frame, "z-10 overflow-clip bg-background")} style={clip}>
      <span className={cn("absolute inset-0 bg-cover bg-center", photoFilter(tone ?? "dark"))} style={{ backgroundImage: image }} />
      <span className={cn("absolute inset-0", scrim(tone ?? "dark"))} />
    </span>
  );
}
