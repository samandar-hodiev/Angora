"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { isAnimatedPreset, measureWallpaperTone, useSaveWallpaper, useWallpaper, type WallpaperTone } from "../wallpaper";

/**
 * Northern lights, drawn the way the real thing looks: a bright ribbon arcing across a night sky
 * with a sharp lower edge and a soft glow rising above it, a fainter band higher up, and a column
 * of light where the ribbon turns. The night sky itself is the preset's own gradient; these are
 * the lights on top of it. Everything is a soft gradient — an earlier version drew the rays as a
 * repeating gradient, which read as zebra stripes rather than light.
 *
 * Everything moves slowly — the ribbons drift and swell over three quarters of a minute, the rays
 * shimmer sideways — so it reads as alive rather than as something flying past. Sized in percent,
 * so the same markup works behind the whole learning area and inside a preview swatch, and
 * reduced motion stills it.
 */
export function AuroraCurtain() {
  return (
    <span aria-hidden className="absolute inset-0 overflow-clip">
      {/* The main ribbon: brightest along its lower edge, fading upwards into the sky. */}
      <span className="absolute top-[16%] -left-[30%] h-[48%] w-[160%] animate-aurora rounded-[50%] bg-[radial-gradient(68%_52%_at_50%_86%,oklch(0.96_0.28_148_/_0.98),oklch(0.86_0.26_152_/_0.7)_24%,oklch(0.66_0.18_168_/_0.26)_54%,transparent_76%)] blur-md motion-reduce:animate-none" />
      {/* A second, fainter band higher up, out of step with the first. */}
      <span className="absolute top-[2%] -left-[20%] h-[40%] w-[150%] animate-aurora-slow rounded-[50%] bg-[radial-gradient(64%_54%_at_45%_86%,oklch(0.89_0.2_155_/_0.5),oklch(0.71_0.16_182_/_0.2)_45%,transparent_76%)] blur-2xl motion-reduce:animate-none" />
      {/* Where the ribbon turns it stands up as a soft column of light, as in the photograph. */}
      <span className="absolute top-[12%] left-[6%] h-[62%] w-[26%] animate-aurora-slow rounded-[50%] bg-[radial-gradient(48%_60%_at_50%_45%,oklch(0.92_0.24_152_/_0.45),oklch(0.72_0.18_168_/_0.18)_50%,transparent_78%)] blur-2xl motion-reduce:animate-none" />
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
