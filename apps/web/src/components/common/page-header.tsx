"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { WallpaperMask } from "@/features/profile/components/wallpaper-layer";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Publishes its own height on the learning area, so what pins or clips below it — the mask
  // above the content, the settings section menu — sits exactly under it whatever the title turns
  // out to be: one line or three, with a description, at any window width or zoom.
  useEffect(() => {
    const element = ref.current;
    const main = element?.closest("main");
    if (!element || !main) return;

    const publish = () => main.style.setProperty("--page-title-h", `${Math.round(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      main.style.removeProperty("--page-title-h");
    };
  }, []);

  return (
    <>
      {/* Covers the band this title sits in, painted over the content: cards scrolling up vanish
          into it 12px before they would reach the title. It repeats the wallpaper exactly, so the
          band still shows the picture rather than a flat bar. */}
      <WallpaperMask />
      <div
        ref={ref}
        // Pinned at its own natural position — the shell header plus the area's top padding — so
        // it does not travel before it sticks, and content never reaches it.
        style={{ top: "calc(var(--app-header-h, 3.5rem) + var(--main-pt, 1.5rem))" }}
        className="sticky z-20 mb-6 flex flex-col gap-4 rounded-xl border bg-surface px-5 py-3.5 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="grid gap-1.5">
          {eyebrow && <div className="text-label text-fg-muted">{eyebrow}</div>}
          <h1 className="text-h1">{title}</h1>
          {description && <p className="max-w-2xl text-body text-fg-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </>
  );
}

export function SectionTitle({ id, title, action }: { id?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {action}
    </div>
  );
}
