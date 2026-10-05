"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The screen shown while the app finds out who you are and loads your workspace.
 *
 * Behind it a liquid green mesh — a net of thin lines with a bead at every crossing — rolls
 * slowly like fabric on water, catching the light where it rises, over a faint field of
 * specks. Something is happening, without a spinner on an empty page. It is a canvas, drawn
 * only while the loader is up, and it holds still for anyone who has asked for reduced motion.
 */

/** Distance between neighbouring crossings, before the mesh bends. */
const SPACING = 34;
// The brand green, and a pale mint for where the mesh catches the light.
const GREEN: [number, number, number] = [16, 185, 129];
const MINT: [number, number, number] = [167, 243, 208];

function mix(a: [number, number, number], b: [number, number, number], k: number) {
  return a.map((v, i) => Math.round(v + (b[i]! - v) * k)) as [number, number, number];
}

function LiquidMesh() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let width = 0;
    let height = 0;
    let specks: { x: number; y: number; r: number; phase: number }[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // A fixed field of specks behind the mesh, like dust in deep water.
      specks = Array.from({ length: Math.round((width * height) / 5000) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.1 + 0.3,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const draw = (time: number) => {
      const t = time / 1000;
      ctx.clearRect(0, 0, width, height);

      for (const s of specks) {
        ctx.fillStyle = `rgba(${MINT[0]}, ${MINT[1]}, ${MINT[2]}, ${0.08 + 0.12 * (Math.sin(t * 1.4 + s.phase) * 0.5 + 0.5)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // The mesh, a little larger than the screen so its edges never show as it bends.
      const cols = Math.ceil(width / SPACING) + 8;
      const rows = Math.ceil(height / SPACING) + 8;
      const px = new Float32Array(cols * rows);
      const py = new Float32Array(cols * rows);
      const lift = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const u = i * 0.12;
          const v = j * 0.12;
          // Two slow swells crossing each other, and a ripple riding on them: fabric on water.
          const swell = Math.sin(u * 0.9 + t * 0.55 + Math.sin(v * 0.6 + t * 0.3) * 1.4);
          const cross = Math.cos(v * 1.1 - t * 0.45 + Math.sin(u * 0.5 - t * 0.25) * 1.2);
          const ripple = Math.sin((u + v) * 1.7 - t * 1.1) * 0.35;
          const k = j * cols + i;
          px[k] = (i - 4) * SPACING + (swell * 0.9 + ripple) * SPACING * 1.8;
          py[k] = (j - 4) * SPACING + (cross * 0.9 - ripple) * SPACING * 1.8;
          // How far this crossing rises towards the light, 0..1.
          lift[k] = Math.min(1, Math.max(0, ((swell + cross) * 0.5 + ripple * 0.6) * 0.5 + 0.5));
        }
      }

      // The threads, gathered into a few paths by brightness rather than stroked one by one.
      const buckets = 5;
      for (let b = 0; b < buckets; b++) {
        ctx.beginPath();
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const k = j * cols + i;
            if (Math.min(buckets - 1, Math.floor(lift[k]! * buckets)) !== b) continue;
            if (i + 1 < cols) {
              ctx.moveTo(px[k]!, py[k]!);
              ctx.lineTo(px[k + 1]!, py[k + 1]!);
            }
            if (j + 1 < rows) {
              ctx.moveTo(px[k]!, py[k]!);
              ctx.lineTo(px[k + cols]!, py[k + cols]!);
            }
          }
        }
        const level = (b + 0.5) / buckets;
        const [r, g, bl] = mix(GREEN, MINT, level * 0.6);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${0.12 + level * 0.38})`;
        ctx.lineWidth = 0.6 + level * 0.7;
        ctx.stroke();
      }

      // A bead at every crossing: bigger and brighter where the mesh rises, with a soft glow
      // and a glint on the highest — the liquid catch of light.
      for (let k = 0; k < cols * rows; k++) {
        const l = lift[k]!;
        const radius = 1.1 + l * 2.2;
        const [r, g, b] = mix(GREEN, MINT, l);
        if (l > 0.72) {
          const glow = ctx.createRadialGradient(px[k]!, py[k]!, 0, px[k]!, py[k]!, radius * 4);
          glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(l - 0.72) * 0.9})`);
          glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(px[k]!, py[k]!, radius * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.35 + l * 0.6})`;
        ctx.beginPath();
        ctx.arc(px[k]!, py[k]!, radius, 0, Math.PI * 2);
        ctx.fill();
        if (l > 0.85) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(l - 0.85) * 4})`;
          ctx.beginPath();
          ctx.arc(px[k]! - radius * 0.35, py[k]! - radius * 0.35, radius * 0.4, 0, Math.PI * 2);
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
      <LiquidMesh />
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
          <span className="loader-sweep absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-200" />
        </div>
      </div>
    </div>
  );
}
