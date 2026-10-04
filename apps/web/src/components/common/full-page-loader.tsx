"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The screen shown while the app finds out who you are and loads your workspace.
 *
 * A grid of small cells fills the background and a slow diagonal wave runs through it, lighting
 * cells in green, blue and red as it passes — something is happening, without a spinner on an
 * empty page. It is a canvas, drawn only while the loader is up, and it holds still for anyone
 * who has asked for reduced motion.
 */

const CELL = 22;
const GAP = 4;
// The brand green, a cool blue and a warm red: the wave's three colours.
const COLORS: [number, number, number][] = [
  [16, 185, 129],
  [59, 130, 246],
  [239, 68, 68],
];

function GridWave() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const t = time / 1000;
      ctx.clearRect(0, 0, width, height);
      const step = CELL + GAP;
      const cols = Math.ceil(width / step) + 1;
      const rows = Math.ceil(height / step) + 1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          // A diagonal wave, with a slower ripple across it so the bands do not look ruled.
          const d = (x + y) * 0.32 - t * 2.2;
          const wave = Math.sin(d) * 0.5 + 0.5;
          const ripple = Math.sin(x * 0.7 - y * 0.45 + t * 1.3) * 0.5 + 0.5;
          const glow = Math.pow(wave, 6) * (0.55 + 0.45 * ripple);
          // Which colour this band lights in, changing every few bands.
          const band = Math.floor(((x + y) * 0.32 - t * 2.2) / (Math.PI * 2));
          const [r, g, b] = COLORS[((band % COLORS.length) + COLORS.length) % COLORS.length]!;
          const alpha = 0.04 + glow * 0.42;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.beginPath();
          ctx.roundRect(x * step, y * step, CELL, CELL, 4);
          ctx.fill();
        }
      }
      if (!still) frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    // The first frame now, not on the next animation frame: a page that is still hidden or
    // busy would otherwise show an empty background until it got one.
    draw(performance.now());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />;
}

export function FullPageLoader({ label }: { label: string }) {
  return (
    <div role="status" className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-background">
      <GridWave />
      {/* A soft dark centre so the label reads over the brightest band. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--background)_0%,color-mix(in_oklab,var(--background)_70%,transparent)_35%,transparent_75%)]"
      />
      <div className="relative grid justify-items-center gap-4 px-6 text-center">
        <span className="relative grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-primary/40 [animation-duration:1.8s]" />
          <Sparkles className="relative size-7" aria-hidden />
        </span>
        <div className="grid gap-1">
          <p className="text-h4 font-semibold tracking-tight">Engora</p>
          <p className="text-body-sm text-fg-secondary">{label}</p>
        </div>
        <div aria-hidden className="relative h-1 w-48 overflow-hidden rounded-full bg-surface-active">
          <span className="loader-sweep absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-emerald-500 via-blue-500 to-red-500" />
        </div>
      </div>
    </div>
  );
}
