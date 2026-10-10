"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { isAnimatedPreset, measureWallpaperTone, type LearnerPreset, useSaveWallpaper, useWallpaper, type WallpaperTone } from "../wallpaper";

/**
 * Northern lights, drawn the way the real thing looks: a bright ribbon arcing across a night sky
 * with a sharp lower edge and a soft glow rising above it, a fainter band higher up, and a column
 * of light where the ribbon turns. The night sky itself is the preset's own gradient; these are
 * the lights on top of it. Everything is a soft gradient — an earlier version drew the rays as a
 * repeating gradient, which read as zebra stripes rather than light.
 *
 * Everything moves slowly — the ribbons drift and swell over three quarters of a minute — so it reads as alive rather than as something flying past. Sized in percent,
 * so the same markup works behind the whole learning area and inside a preview swatch; reduced
 * motion, or the learner choosing "Still", holds it in place.
 */
export function AuroraCurtain({ still = false }: { still?: boolean }) {
  // "Still" keeps the lights exactly where they are; the night sky stays the same either way.
  const motion = still ? "" : "animate-aurora motion-reduce:animate-none";
  const slow = still ? "" : "animate-aurora-slow motion-reduce:animate-none";
  return (
    <span aria-hidden className="absolute inset-0 overflow-clip">
      {/* The main ribbon: brightest along its lower edge, fading upwards into the sky. */}
      <span className={`absolute top-[16%] -left-[30%] h-[48%] w-[160%] ${motion} rounded-[50%] bg-[radial-gradient(68%_52%_at_50%_86%,oklch(0.96_0.28_148_/_0.98),oklch(0.86_0.26_152_/_0.7)_24%,oklch(0.66_0.18_168_/_0.26)_54%,transparent_76%)] blur-md`} />
      {/* A second, fainter band higher up, out of step with the first. */}
      <span className={`absolute top-[2%] -left-[20%] h-[40%] w-[150%] ${slow} rounded-[50%] bg-[radial-gradient(64%_54%_at_45%_86%,oklch(0.89_0.2_155_/_0.5),oklch(0.71_0.16_182_/_0.2)_45%,transparent_76%)] blur-2xl`} />
      {/* Where the ribbon turns it stands up as a soft column of light, as in the photograph. */}
      <span className={`absolute top-[12%] left-[6%] h-[62%] w-[26%] ${slow} rounded-[50%] bg-[radial-gradient(48%_60%_at_50%_45%,oklch(0.92_0.24_152_/_0.45),oklch(0.72_0.18_168_/_0.18)_50%,transparent_78%)] blur-2xl`} />
    </span>
  );
}

/**
 * Dimming settles the picture towards the colour text over it already expects: a dark scene
 * goes darker, a light one lighter, and a plain colour wash fades into the page. So the slider
 * never flips which way the text should read.
 */
function dimColour(tone: WallpaperTone | null) {
  if (tone === "dark") return "oklch(0.12 0.01 165)";
  if (tone === "light") return "oklch(0.985 0.004 165)";
  return "var(--background)";
}

/**
 * The picture itself, as it is drawn behind the learning area and again in the title band:
 * the image (drifting when live), the aurora's lights, a photo's settle, and the dim on top.
 */
export function WallpaperScene({
  image,
  custom,
  aurora,
  live,
  dim,
  tone,
}: {
  image: string;
  custom: boolean;
  aurora: boolean;
  live: boolean;
  dim: number;
  tone: WallpaperTone | null;
}) {
  return (
    <>
      {/* The aurora's own lights do the moving; its night sky stays put under them. */}
      <span
        className={cn("absolute bg-cover bg-center", live && !aurora ? "-inset-[6%] wallpaper-drift" : "inset-0")}
        style={{ backgroundImage: image }}
      />
      {aurora && <AuroraCurtain still={!live} />}
      {/* A light settle in the photo's own direction; see [data-wallpaper-tone] in theme.css. */}
      {custom && <span className="absolute inset-0 bg-(--photo-scrim)" />}
      {dim > 0 && <span className="absolute inset-0" style={{ backgroundColor: dimColour(tone), opacity: dim / 100 }} />}
    </>
  );
}

/** Whether the preset is the aurora, whose lights are drawn on top of its sky. */
export function isAurora(preset: LearnerPreset | null): boolean {
  return !!preset && !("tone" in preset) && isAnimatedPreset(preset);
}

/** The learning area, in the shell's own terms: below the header, right of the sidebar. */
// The shell's own measurements, read from the variables it sets: the sidebar can be resized.
const frame =
  "pointer-events-none fixed top-(--app-header-h,3rem) right-0 bottom-0 left-0 md:left-(--learner-sidebar-w,13.5rem)";

/** Everything above this line belongs to the title, not to the scrolling content. */
const maskHeight = "calc(var(--main-pt, 1.5rem) + var(--page-title-h, 3.5rem) + 0.75rem)";

/**
 * The learner's background. It fills the main learning area only — never the header or the
 * sidebar — and is genuinely fixed to the viewport, inset to the shell's own measurements, so it
 * does not move by a pixel while the page scrolls.
 *
 * A photo is shown as it is, the same in both themes. Its measured tone decides which way the
 * text lying on it runs and which way the light scrim settles it (see [data-wallpaper-tone] in
 * theme.css); cards keep the theme regardless. The flower scenes carry a tone of their own; the
 * gradient presets are colour washes and need none of it. Live drift and the learner's dim are
 * drawn by WallpaperScene.
 */
export function WallpaperLayer() {
  const { image, selection, tone, photoUrl, preset, motion, dim } = useWallpaper();
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

  return (
    <span aria-hidden className={cn(frame, "-z-10 overflow-clip")}>
      <WallpaperScene image={image} custom={selection === "custom"} aurora={isAurora(preset)} live={motion === "live"} dim={dim} tone={tone} />
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
  const { image, selection, preset, motion, dim, tone } = useWallpaper();
  const clip = { clipPath: `inset(0 0 calc(100% - ${maskHeight}) 0)` };

  if (!image) return <span aria-hidden className={cn(frame, "z-10 bg-background")} style={clip} />;

  return (
    <span aria-hidden className={cn(frame, "z-10 overflow-clip bg-background")} style={clip}>
      <WallpaperScene image={image} custom={selection === "custom"} aurora={isAurora(preset)} live={motion === "live"} dim={dim} tone={tone} />
    </span>
  );
}
